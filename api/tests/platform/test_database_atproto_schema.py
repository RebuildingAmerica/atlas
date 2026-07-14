"""ATProto identity-graph schema created by database initialization."""

from __future__ import annotations

import asyncio
import sys
from types import SimpleNamespace
from typing import TYPE_CHECKING

import aiosqlite
import psycopg
import pytest

from atlas.models import database as database_module
from atlas.models import init_db
from atlas.models.database import PostgresConnection, _init_postgres, _load_postgres_schema
from atlas.models.database_migrations import (
    _ATPROTO_GRAPH_POSTGRES_DDL,
    _migration_id,
    migrate_atproto_identity_graph,
)

if TYPE_CHECKING:
    from pathlib import Path
    from typing import Any

IDENTITY_COLUMNS = {
    "id",
    "did",
    "current_handle",
    "pds_url",
    "resolution_status",
    "did_resolved_at",
    "handle_verified_at",
    "last_resolution_error",
    "created_at",
    "updated_at",
}
CONTROL_COLUMNS = {
    "id",
    "identity_id",
    "user_id",
    "status",
    "verified_at",
    "disconnected_at",
    "created_at",
    "updated_at",
}
PROFILE_LINK_COLUMNS = {
    "id",
    "entry_id",
    "identity_id",
    "claim_id",
    "proof_id",
    "status",
    "verified_at",
    "last_checked_at",
    "removed_at",
    "created_at",
    "updated_at",
}
LEGACY_ENTRY_COLUMNS = {
    "linked_atproto_did",
    "linked_atproto_handle",
    "linked_atproto_verified_at",
}


async def _columns(conn: aiosqlite.Connection, table: str) -> set[str]:
    cursor = await conn.execute(f"PRAGMA table_info({table})")
    return {str(row[1]) for row in await cursor.fetchall()}


async def _postgres_columns(conn: PostgresConnection, table: str) -> set[str]:
    cursor = await conn.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ?
        """,
        (table,),
    )
    return {str(row[0]) for row in await cursor.fetchall()}


async def _insert_postgres_identity(
    conn: PostgresConnection,
    identity_id: str,
    did: str,
) -> None:
    await conn.execute(
        """
        INSERT INTO atproto_identities (
            id, did, current_handle, resolution_status, created_at, updated_at
        ) VALUES (?, ?, ?, 'verified', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """,
        (identity_id, did, f"{identity_id}.example"),
    )


async def _insert_postgres_control(
    conn: PostgresConnection,
    control_id: str,
    identity_id: str,
    user_id: str,
    status: str,
) -> None:
    await conn.execute(
        """
        INSERT INTO user_atproto_controls (
            id, identity_id, user_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """,
        (control_id, identity_id, user_id, status),
    )


async def _insert_postgres_link(
    conn: PostgresConnection,
    link_id: str,
    identity_id: str,
    status: str,
) -> None:
    await conn.execute(
        """
        INSERT INTO profile_atproto_links (
            id, entry_id, identity_id, status, created_at, updated_at
        ) VALUES (?, 'entry-one', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """,
        (link_id, identity_id, status),
    )


async def _prepare_legacy_postgres_database(
    database_url: str,
    *,
    handle: str | None = "postgres.example",
    partial_controller_user_id: str | None = None,
    with_verified_proof: bool = False,
) -> None:
    await init_db(database_url)
    raw_conn = await psycopg.AsyncConnection.connect(database_url, autocommit=True)
    conn = PostgresConnection(raw_conn)
    try:
        for statement in (
            "DROP TABLE profile_atproto_links",
            "DROP TABLE user_atproto_controls",
            "DROP TABLE atproto_identity_delegations",
            "DROP TABLE organization_atproto_identities",
            "DROP TABLE atproto_identities",
            "ALTER TABLE entries ADD COLUMN linked_atproto_did TEXT",
            "ALTER TABLE entries ADD COLUMN linked_atproto_handle TEXT",
            "ALTER TABLE entries ADD COLUMN linked_atproto_verified_at TIMESTAMPTZ",
            """
            CREATE TABLE atproto_identities (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                did TEXT NOT NULL,
                current_handle TEXT NOT NULL,
                pds_url TEXT,
                did_resolved_at TIMESTAMPTZ NOT NULL,
                handle_verified_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL,
                UNIQUE(user_id, did)
            )
            """,
            "CREATE INDEX idx_atproto_identities_user ON atproto_identities(user_id)",
            "CREATE INDEX idx_atproto_identities_did ON atproto_identities(did)",
        ):
            await conn.execute(statement)
        await conn.execute(
            """
            INSERT INTO atproto_identities (
                id, user_id, did, current_handle, pds_url, did_resolved_at,
                handle_verified_at, created_at, updated_at
            ) VALUES (
                'identity-postgres', 'user-postgres', 'did:plc:postgres',
                'postgres.example', 'https://pds.example',
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            """
        )
        await conn.execute(
            """
            INSERT INTO entries (
                id, type, name, description, geo_specificity,
                linked_atproto_did, linked_atproto_handle, linked_atproto_verified_at,
                first_seen, last_seen, created_at, updated_at
            ) VALUES (
                'entry-postgres', 'person', 'Postgres', 'Postgres', 'local',
                'did:plc:postgres', ?, CURRENT_TIMESTAMP,
                CURRENT_DATE, CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            """,
            (handle,),
        )
        if partial_controller_user_id is not None:
            for statement in _ATPROTO_GRAPH_POSTGRES_DDL[1:]:
                await conn.execute(statement)
            control_id = _migration_id(
                "control",
                "identity-postgres",
                partial_controller_user_id,
            )
            link_id = _migration_id(
                "profile-link",
                "entry-postgres",
                "identity-postgres",
            )
            await conn.execute(
                """
                INSERT INTO user_atproto_controls (
                    id, identity_id, user_id, status, verified_at, created_at, updated_at
                ) VALUES (
                    ?, 'identity-postgres', ?, 'active',
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """,
                (control_id, partial_controller_user_id),
            )
            await conn.execute(
                """
                INSERT INTO profile_atproto_links (
                    id, entry_id, identity_id, status, verified_at,
                    last_checked_at, created_at, updated_at
                ) VALUES (
                    ?, 'entry-postgres', 'identity-postgres', 'verified',
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """,
                (link_id,),
            )
        if with_verified_proof:
            await conn.execute(
                """
                INSERT INTO profile_claims (
                    id, entry_id, user_id, user_email, status, tier,
                    verified_at, created_at, updated_at
                ) VALUES (
                    'claim-postgres', 'entry-postgres', 'user-postgres',
                    'postgres@example.com', 'verified', 1,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """
            )
            await conn.execute(
                """
                INSERT INTO profile_claim_proofs (
                    id, claim_id, proof_type, proof_status, proof_summary,
                    proof_metadata_json, created_at, reviewed_at
                ) VALUES (
                    'proof-postgres', 'claim-postgres', 'atproto', 'verified',
                    'ATProto evidence.',
                    '{"did":"did:plc:postgres","handle":"postgres.example"}',
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """
            )
    finally:
        await raw_conn.close()


async def _wait_for_postgres_lock_waiters(conn: Any, *, expected: int) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + 5
    while loop.time() < deadline:
        cursor = await conn.execute(
            """
            SELECT COUNT(*)
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
            """
        )
        row = await cursor.fetchone()
        if row is not None and int(row[0]) >= expected:
            return
        await asyncio.sleep(0.01)
    cursor = await conn.execute(
        """
        SELECT state, wait_event_type, wait_event, query
        FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
        ORDER BY pid
        """
    )
    pytest.fail(f"PostgreSQL activity: {await cursor.fetchall()!r}")


class _PausingPostgresConnection:
    backend = "postgres"

    def __init__(
        self,
        inner: PostgresConnection,
        *,
        source_read_reached: asyncio.Event,
        resume_source_read: asyncio.Event,
    ) -> None:
        self._inner = inner
        self._source_read_reached = source_read_reached
        self._resume_source_read = resume_source_read

    async def execute(
        self,
        statement: str,
        parameters: tuple[Any, ...] = (),
    ) -> Any:
        if "FROM entries ORDER BY updated_at DESC, id DESC" in " ".join(statement.split()):
            self._source_read_reached.set()
            await self._resume_source_read.wait()
        return await self._inner.execute(statement, parameters)


@pytest.mark.asyncio
async def test_fresh_sqlite_schema_creates_independent_atproto_identity_graph(
    tmp_path: Path,
) -> None:
    """Fresh databases should separate identities, controls, and profile links."""
    database_path = tmp_path / "atlas.db"
    db_url = f"sqlite:///{database_path}"

    await init_db(db_url)

    conn = await aiosqlite.connect(database_path)
    try:
        assert await _columns(conn, "atproto_identities") == IDENTITY_COLUMNS
        assert await _columns(conn, "user_atproto_controls") == CONTROL_COLUMNS
        assert await _columns(conn, "profile_atproto_links") == PROFILE_LINK_COLUMNS
        assert LEGACY_ENTRY_COLUMNS.isdisjoint(await _columns(conn, "entries"))

        index_cursor = await conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%atproto%'"
        )
        index_names = {str(row[0]) for row in await index_cursor.fetchall()}
        assert "idx_atproto_identities_user" not in index_names
        assert "idx_atproto_identities_did" not in index_names
        assert "idx_user_atproto_controls_active_identity" in index_names
        assert "idx_profile_atproto_links_non_removed_entry" in index_names
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_fresh_sqlite_schema_enforces_identity_relationship_cardinality(
    tmp_path: Path,
) -> None:
    """One DID, active controller, and current profile link should be enforceable."""
    database_path = tmp_path / "atlas.db"
    await init_db(f"sqlite:///{database_path}")

    conn = await aiosqlite.connect(database_path)
    try:
        timestamp = "2026-07-12T12:00:00+00:00"
        await conn.execute(
            """
            INSERT INTO atproto_identities (
                id, did, current_handle, resolution_status, created_at, updated_at
            ) VALUES (?, ?, ?, 'verified', ?, ?)
            """,
            ("identity-1", "did:plc:one", "one.example", timestamp, timestamp),
        )
        with pytest.raises(aiosqlite.IntegrityError):
            await conn.execute(
                """
                INSERT INTO atproto_identities (
                    id, did, current_handle, resolution_status, created_at, updated_at
                ) VALUES (?, ?, ?, 'verified', ?, ?)
                """,
                ("identity-2", "did:plc:one", "other.example", timestamp, timestamp),
            )
        await conn.rollback()

        await conn.execute(
            """
            INSERT INTO atproto_identities (
                id, did, current_handle, resolution_status, created_at, updated_at
            ) VALUES (?, ?, ?, 'verified', ?, ?)
            """,
            ("identity-1", "did:plc:one", "one.example", timestamp, timestamp),
        )
        await conn.execute(
            """
            INSERT INTO user_atproto_controls (
                id, identity_id, user_id, status, verified_at, created_at, updated_at
            ) VALUES (?, ?, ?, 'active', ?, ?, ?)
            """,
            ("control-1", "identity-1", "user-1", timestamp, timestamp, timestamp),
        )
        with pytest.raises(aiosqlite.IntegrityError):
            await conn.execute(
                """
                INSERT INTO user_atproto_controls (
                    id, identity_id, user_id, status, verified_at, created_at, updated_at
                ) VALUES (?, ?, ?, 'active', ?, ?, ?)
                """,
                ("control-2", "identity-1", "user-2", timestamp, timestamp, timestamp),
            )
        await conn.rollback()

        await conn.execute(
            """
            INSERT INTO atproto_identities (
                id, did, current_handle, resolution_status, created_at, updated_at
            ) VALUES (?, ?, ?, 'verified', ?, ?)
            """,
            ("identity-1", "did:plc:one", "one.example", timestamp, timestamp),
        )
        await conn.execute(
            """
            INSERT INTO entries (
                id, type, name, description, geo_specificity,
                first_seen, last_seen, created_at, updated_at
            ) VALUES (?, 'person', 'One', 'One', 'local', ?, ?, ?, ?)
            """,
            ("entry-1", timestamp, timestamp, timestamp, timestamp),
        )
        await conn.execute(
            """
            INSERT INTO profile_atproto_links (
                id, entry_id, identity_id, status, verified_at, created_at, updated_at
            ) VALUES (?, ?, ?, 'verified', ?, ?, ?)
            """,
            ("link-1", "entry-1", "identity-1", timestamp, timestamp, timestamp),
        )
        with pytest.raises(aiosqlite.IntegrityError):
            await conn.execute(
                """
                INSERT INTO profile_atproto_links (
                    id, entry_id, identity_id, status, verified_at, created_at, updated_at
                ) VALUES (?, ?, ?, 'reverification_required', ?, ?, ?)
                """,
                ("link-2", "entry-1", "identity-1", timestamp, timestamp, timestamp),
            )
    finally:
        await conn.close()


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
