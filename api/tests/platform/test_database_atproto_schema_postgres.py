"""The ATProto identity graph as PostgreSQL builds and migrates it."""

from __future__ import annotations

import asyncio
import sys
from types import SimpleNamespace
from typing import TYPE_CHECKING

import psycopg
import pytest

from atlas.models import database as database_module
from atlas.models import init_db
from atlas.models.database import PostgresConnection, _init_postgres, _load_postgres_schema
from atlas.models.database_migrations import (
    _migration_id,
    migrate_atproto_identity_graph,
)

if TYPE_CHECKING:
    from typing import Any

from tests.platform.atproto_schema_support import (
    CONTROL_COLUMNS,
    IDENTITY_COLUMNS,
    LEGACY_ENTRY_COLUMNS,
    PROFILE_LINK_COLUMNS,
    _insert_postgres_control,
    _insert_postgres_identity,
    _insert_postgres_link,
    _PausingPostgresConnection,
    _postgres_columns,
    _prepare_legacy_postgres_database,
    _wait_for_postgres_lock_waiters,
)


def test_postgres_schema_defines_independent_atproto_identity_graph() -> None:
    """Production DDL should enforce the same identity graph and state vocabulary."""
    schema = _load_postgres_schema()

    assert "CREATE TABLE IF NOT EXISTS user_atproto_controls" in schema
    assert "CREATE TABLE IF NOT EXISTS profile_atproto_links" in schema
    assert "UNIQUE(did)" in schema
    assert "resolution_status IN ('verified', 'needs_attention')" in schema
    assert "status IN ('active', 'disconnected', 'conflict')" in schema
    assert "status IN ('verified', 'reverification_required', 'removed')" in schema
    assert "idx_user_atproto_controls_active_identity" in schema
    assert "WHERE status = 'active'" in schema
    assert "idx_profile_atproto_links_non_removed_entry" in schema
    assert "WHERE status <> 'removed'" in schema
    assert "idx_atproto_identities_user" not in schema
    assert "idx_atproto_identities_did" not in schema
    assert "linked_atproto_did" not in schema
    assert "linked_atproto_handle" not in schema
    assert "linked_atproto_verified_at" not in schema


@pytest.mark.asyncio
async def test_postgres_fresh_schema_enforces_identity_relationship_cardinality(
    postgres_database_url: str,
) -> None:
    """Production PostgreSQL should enforce the same graph shape and cardinality."""
    await init_db(postgres_database_url)
    raw_conn = await psycopg.AsyncConnection.connect(postgres_database_url, autocommit=True)
    conn = PostgresConnection(raw_conn)
    try:
        assert await _postgres_columns(conn, "atproto_identities") == IDENTITY_COLUMNS
        assert await _postgres_columns(conn, "user_atproto_controls") == CONTROL_COLUMNS
        assert await _postgres_columns(conn, "profile_atproto_links") == PROFILE_LINK_COLUMNS
        assert LEGACY_ENTRY_COLUMNS.isdisjoint(await _postgres_columns(conn, "entries"))

        await _insert_postgres_identity(conn, "identity-one", "did:plc:one")
        with pytest.raises(psycopg.errors.UniqueViolation):
            await _insert_postgres_identity(conn, "identity-duplicate", "did:plc:one")
        await _insert_postgres_identity(conn, "identity-two", "did:plc:two")

        await _insert_postgres_control(conn, "control-one", "identity-one", "user-one", "active")
        with pytest.raises(psycopg.errors.UniqueViolation):
            await _insert_postgres_control(
                conn, "control-two", "identity-one", "user-two", "active"
            )
        await _insert_postgres_control(
            conn, "control-two", "identity-one", "user-two", "disconnected"
        )

        await conn.execute(
            """
            INSERT INTO entries (
                id, type, name, description, geo_specificity,
                first_seen, last_seen, created_at, updated_at
            ) VALUES (
                'entry-one', 'person', 'One', 'One', 'local',
                CURRENT_DATE, CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            """
        )
        await _insert_postgres_link(conn, "link-one", "identity-one", "verified")
        with pytest.raises(psycopg.errors.UniqueViolation):
            await _insert_postgres_link(conn, "link-two", "identity-two", "reverification_required")
        await _insert_postgres_link(conn, "link-two", "identity-two", "removed")
    finally:
        await raw_conn.close()


@pytest.mark.asyncio
async def test_postgres_legacy_identity_migration_is_idempotent(
    postgres_database_url: str,
) -> None:
    """Stored PostgreSQL identity provenance should survive migration and repeat startup."""
    await _prepare_legacy_postgres_database(postgres_database_url)

    await init_db(postgres_database_url)
    await init_db(postgres_database_url)

    raw_conn = await psycopg.AsyncConnection.connect(postgres_database_url, autocommit=True)
    conn = PostgresConnection(raw_conn)
    try:
        identity_cursor = await conn.execute(
            "SELECT id, did, resolution_status FROM atproto_identities"
        )
        assert await identity_cursor.fetchall() == [
            ("identity-postgres", "did:plc:postgres", "verified")
        ]
        control_cursor = await conn.execute(
            "SELECT identity_id, user_id, status FROM user_atproto_controls"
        )
        assert await control_cursor.fetchall() == [("identity-postgres", "user-postgres", "active")]
        link_cursor = await conn.execute(
            "SELECT entry_id, identity_id, status FROM profile_atproto_links"
        )
        assert await link_cursor.fetchall() == [("entry-postgres", "identity-postgres", "verified")]
        assert LEGACY_ENTRY_COLUMNS.isdisjoint(await _postgres_columns(conn, "entries"))
    finally:
        await raw_conn.close()


@pytest.mark.asyncio
async def test_postgres_partial_controller_conflicts_with_legacy_owner(
    postgres_database_url: str,
) -> None:
    """Restored and legacy-owner controls should share conflict semantics in PostgreSQL."""
    restored_user_id = "user-restored-controller"
    await _prepare_legacy_postgres_database(
        postgres_database_url,
        partial_controller_user_id=restored_user_id,
    )

    await init_db(postgres_database_url)

    raw_conn = await psycopg.AsyncConnection.connect(postgres_database_url, autocommit=True)
    conn = PostgresConnection(raw_conn)
    try:
        owner_control_id = _migration_id(
            "control",
            "identity-postgres",
            "user-postgres",
        )
        restored_control_id = _migration_id(
            "control",
            "identity-postgres",
            restored_user_id,
        )
        controls_cursor = await conn.execute(
            """
            SELECT id, identity_id, user_id, status
            FROM user_atproto_controls
            ORDER BY user_id
            """
        )
        assert await controls_cursor.fetchall() == [
            (owner_control_id, "identity-postgres", "user-postgres", "conflict"),
            (restored_control_id, "identity-postgres", restored_user_id, "conflict"),
        ]
        link_id = _migration_id(
            "profile-link",
            "entry-postgres",
            "identity-postgres",
        )
        link_cursor = await conn.execute(
            "SELECT id, identity_id FROM profile_atproto_links WHERE id = ?",
            (link_id,),
        )
        assert await link_cursor.fetchone() == (link_id, "identity-postgres")
        for table in ("user_atproto_controls", "profile_atproto_links"):
            orphan_cursor = await conn.execute(
                f"""
                SELECT COUNT(*)
                FROM {table} AS child
                LEFT JOIN atproto_identities AS identity ON identity.id = child.identity_id
                WHERE identity.id IS NULL
                """
            )
            assert await orphan_cursor.fetchone() == (0,)
        assert LEGACY_ENTRY_COLUMNS.isdisjoint(await _postgres_columns(conn, "entries"))
        archive_cursor = await conn.execute("SELECT to_regclass('atproto_identities_legacy')")
        assert await archive_cursor.fetchone() == (None,)
        rows_before_second_init = {}
        for table in (
            "atproto_identities",
            "user_atproto_controls",
            "profile_atproto_links",
        ):
            cursor = await conn.execute(f"SELECT * FROM {table} ORDER BY id")
            rows_before_second_init[table] = await cursor.fetchall()

        await init_db(postgres_database_url)

        for table, expected_rows in rows_before_second_init.items():
            cursor = await conn.execute(f"SELECT * FROM {table} ORDER BY id")
            assert await cursor.fetchall() == expected_rows
    finally:
        await raw_conn.close()


@pytest.mark.asyncio
async def test_concurrent_postgres_initialization_serializes_before_introspection(
    postgres_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Concurrent replicas should classify and migrate one legacy schema exactly once."""
    await _prepare_legacy_postgres_database(postgres_database_url)
    original_connect = psycopg.AsyncConnection.connect
    initializer_connections = [
        await original_connect(postgres_database_url, autocommit=False),
        await original_connect(postgres_database_url, autocommit=False),
    ]
    queued_connections = iter(initializer_connections)

    async def use_preopened_connection(database_url: str, *, autocommit: bool) -> Any:
        assert database_url == postgres_database_url
        assert autocommit is False
        return next(queued_connections)

    monkeypatch.setattr(
        psycopg.AsyncConnection,
        "connect",
        staticmethod(use_preopened_connection),
    )
    blocker = await original_connect(postgres_database_url, autocommit=False)
    initializers: list[asyncio.Task[None]] = []
    try:
        await blocker.execute("LOCK TABLE entries IN ACCESS EXCLUSIVE MODE")
        initializers = [
            asyncio.create_task(init_db(postgres_database_url)),
            asyncio.create_task(init_db(postgres_database_url)),
        ]
        await _wait_for_postgres_lock_waiters(blocker, expected=2)
        await blocker.commit()
        await asyncio.wait_for(asyncio.gather(*initializers), timeout=20)
    finally:
        await blocker.rollback()
        for initializer in initializers:
            if not initializer.done():
                initializer.cancel()
        await asyncio.gather(*initializers, return_exceptions=True)
        await blocker.close()

    raw_conn = await original_connect(postgres_database_url, autocommit=True)
    conn = PostgresConnection(raw_conn)
    try:
        counts = []
        for table in (
            "atproto_identities",
            "user_atproto_controls",
            "profile_atproto_links",
        ):
            cursor = await conn.execute(f"SELECT COUNT(*) FROM {table}")
            counts.append(await cursor.fetchone())
        assert counts == [(1,), (1,), (1,)]
        assert LEGACY_ENTRY_COLUMNS.isdisjoint(await _postgres_columns(conn, "entries"))
        archive_cursor = await conn.execute("SELECT to_regclass('atproto_identities_legacy')")
        assert await archive_cursor.fetchone() == (None,)
    finally:
        await raw_conn.close()


@pytest.mark.asyncio
async def test_postgres_corrupt_legacy_link_rolls_back(postgres_database_url: str) -> None:
    """A corrupt PostgreSQL legacy pair should leave its original storage untouched."""
    await _prepare_legacy_postgres_database(postgres_database_url, handle=None)

    with pytest.raises(
        RuntimeError,
        match="Corrupt legacy ATProto link for entry entry-postgres",
    ):
        await init_db(postgres_database_url)

    raw_conn = await psycopg.AsyncConnection.connect(postgres_database_url, autocommit=True)
    conn = PostgresConnection(raw_conn)
    try:
        assert "user_id" in await _postgres_columns(conn, "atproto_identities")
        assert await _postgres_columns(conn, "entries") >= LEGACY_ENTRY_COLUMNS
        archive_cursor = await conn.execute("SELECT to_regclass('atproto_identities_legacy')")
        assert await archive_cursor.fetchone() == (None,)
    finally:
        await raw_conn.close()


@pytest.mark.asyncio
async def test_postgres_migration_locks_sources_before_reading_rows(
    postgres_database_url: str,
) -> None:
    """Old-runtime writes should block before the migration snapshots source rows."""
    await _prepare_legacy_postgres_database(
        postgres_database_url,
        with_verified_proof=True,
    )
    migration_raw = await psycopg.AsyncConnection.connect(
        postgres_database_url,
        autocommit=False,
    )
    observer_raw = await psycopg.AsyncConnection.connect(
        postgres_database_url,
        autocommit=True,
    )
    migration_conn = PostgresConnection(migration_raw)
    observer_conn = PostgresConnection(observer_raw)
    pid_cursor = await migration_conn.execute("SELECT pg_backend_pid()")
    pid_row = await pid_cursor.fetchone()
    assert pid_row is not None
    source_read_reached = asyncio.Event()
    resume_source_read = asyncio.Event()
    pausing_conn = _PausingPostgresConnection(
        migration_conn,
        source_read_reached=source_read_reached,
        resume_source_read=resume_source_read,
    )
    migration_task = asyncio.create_task(
        migrate_atproto_identity_graph(pausing_conn, backend="postgres")
    )
    try:
        await asyncio.wait_for(source_read_reached.wait(), timeout=5)
        lock_cursor = await observer_conn.execute(
            """
            SELECT relation.relname, locks.mode
            FROM pg_locks AS locks
            JOIN pg_class AS relation ON relation.oid = locks.relation
            WHERE locks.pid = ?
              AND locks.granted
              AND relation.relname IN (
                  'entries', 'atproto_identities',
                  'profile_claims', 'profile_claim_proofs'
              )
            """,
            (pid_row[0],),
        )
        locks = {(str(row[0]), str(row[1])) for row in await lock_cursor.fetchall()}
        assert {
            ("entries", "AccessExclusiveLock"),
            ("atproto_identities", "AccessExclusiveLock"),
            ("profile_claims", "AccessExclusiveLock"),
            ("profile_claim_proofs", "AccessExclusiveLock"),
        } <= locks

        await observer_conn.execute("SET lock_timeout = '100ms'")
        with pytest.raises(psycopg.errors.LockNotAvailable):
            await observer_conn.execute(
                "UPDATE entries SET updated_at = CURRENT_TIMESTAMP WHERE id = 'entry-postgres'"
            )
        with pytest.raises(psycopg.errors.LockNotAvailable):
            await observer_conn.execute(
                """
                UPDATE profile_claim_proofs
                SET proof_status = 'rejected'
                WHERE id = 'proof-postgres'
                """
            )
    finally:
        resume_source_read.set()
        try:
            await asyncio.wait_for(migration_task, timeout=5)
            await migration_raw.commit()
        finally:
            await observer_raw.close()
            await migration_raw.close()


@pytest.mark.asyncio
async def test_postgres_initialization_migrates_before_loading_fresh_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PostgreSQL initialization should migrate stored trust data before fresh DDL."""
    events: list[str] = []

    class FakeConnection:
        async def execute(self, sql: str, parameters: object = None) -> object:
            del parameters
            events.append(f"schema:{sql}")
            return object()

        async def commit(self) -> None:
            events.append("commit")

        async def rollback(self) -> None:
            events.append("rollback")

        async def close(self) -> None:
            events.append("close")

    connection = FakeConnection()

    class FakeAsyncConnection:
        @staticmethod
        async def connect(database_url: str, *, autocommit: bool) -> FakeConnection:
            assert database_url == "postgresql://localhost/atlas"
            assert autocommit is False
            return connection

    async def fake_migrate(conn: object, *, backend: str) -> None:
        assert backend == "postgres"
        assert getattr(conn, "backend", None) == "postgres"
        events.append("migrate")

    monkeypatch.setitem(
        sys.modules, "psycopg", SimpleNamespace(AsyncConnection=FakeAsyncConnection)
    )
    monkeypatch.setattr(
        database_module, "migrate_atproto_identity_graph", fake_migrate, raising=False
    )
    monkeypatch.setattr(database_module, "_load_postgres_schema", lambda: "SELECT fresh_schema")

    await _init_postgres("postgresql://localhost/atlas")

    assert events == ["migrate", "schema:SELECT fresh_schema", "commit", "close"]
