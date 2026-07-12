"""Tests for database schema migration helpers."""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING
from uuid import UUID

import aiosqlite
import pytest

from atlas.models.database import (
    _ensure_discovery_job_columns,
    _ensure_discovery_run_columns,
    _ensure_entry_columns,
    _ensure_org_annotation_columns,
    init_db,
)
from atlas.models.database_migrations import (
    _ATPROTO_GRAPH_SQLITE_DDL,
    _migration_id,
    migrate_atproto_identity_graph,
)

if TYPE_CHECKING:
    from pathlib import Path

TIMESTAMP = "2026-07-12T12:00:00+00:00"
LEGACY_ATPROTO_COLUMNS = {
    "linked_atproto_did",
    "linked_atproto_handle",
    "linked_atproto_verified_at",
}


async def _reset_to_legacy_atproto_schema(conn: aiosqlite.Connection) -> None:
    """Replace only the fresh ATProto graph with the pre-migration shape."""
    await conn.executescript(
        """
        DROP TABLE IF EXISTS profile_atproto_links;
        DROP TABLE IF EXISTS user_atproto_controls;
        DROP TABLE IF EXISTS atproto_identities;
        """
    )
    cursor = await conn.execute("PRAGMA table_info(entries)")
    entry_columns = {str(row[1]) for row in await cursor.fetchall()}
    for column in sorted(LEGACY_ATPROTO_COLUMNS - entry_columns):
        await conn.execute(f"ALTER TABLE entries ADD COLUMN {column} TEXT")
    await conn.executescript(
        """
        CREATE TABLE atproto_identities (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            did TEXT NOT NULL,
            current_handle TEXT NOT NULL,
            pds_url TEXT,
            did_resolved_at TEXT NOT NULL,
            handle_verified_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, did)
        );
        CREATE INDEX idx_atproto_identities_user ON atproto_identities(user_id);
        CREATE INDEX idx_atproto_identities_did ON atproto_identities(did);
        """
    )


async def _insert_legacy_entry(
    conn: aiosqlite.Connection,
    entry_id: str,
    *,
    did: str | None,
    handle: str | None,
    verified_at: str | None,
) -> None:
    await conn.execute(
        """
        INSERT INTO entries (
            id, type, name, description, geo_specificity,
            linked_atproto_did, linked_atproto_handle, linked_atproto_verified_at,
            first_seen, last_seen, created_at, updated_at
        ) VALUES (?, 'person', ?, ?, 'local', ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            entry_id,
            entry_id,
            entry_id,
            did,
            handle,
            verified_at,
            TIMESTAMP,
            TIMESTAMP,
            TIMESTAMP,
            TIMESTAMP,
        ),
    )


async def _insert_legacy_identity_link(
    conn: aiosqlite.Connection,
    *,
    key: str,
    did: str,
    handle: str,
    pds_url: str | None = None,
) -> tuple[str, str, str]:
    identity_id = f"identity-{key}"
    user_id = f"user-{key}"
    entry_id = f"entry-{key}"
    await conn.execute(
        """
        INSERT INTO atproto_identities (
            id, user_id, did, current_handle, pds_url, did_resolved_at,
            handle_verified_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (identity_id, user_id, did, handle, pds_url, TIMESTAMP, TIMESTAMP, TIMESTAMP, TIMESTAMP),
    )
    await _insert_legacy_entry(
        conn,
        entry_id,
        did=did,
        handle=handle,
        verified_at=TIMESTAMP,
    )
    return identity_id, user_id, entry_id


async def _legacy_database(database_path: Path) -> aiosqlite.Connection:
    await init_db(f"sqlite:///{database_path}")
    conn = await aiosqlite.connect(database_path)
    await _reset_to_legacy_atproto_schema(conn)
    return conn


async def _create_partial_atproto_graph(
    conn: aiosqlite.Connection,
    *,
    identity_id: str,
    user_id: str,
    entry_id: str,
) -> tuple[str, str]:
    for statement in _ATPROTO_GRAPH_SQLITE_DDL[1:]:
        await conn.execute(statement)
    control_id = _migration_id("control", identity_id, user_id)
    link_id = _migration_id("profile-link", entry_id, identity_id)
    await conn.execute(
        """
        INSERT INTO user_atproto_controls (
            id, identity_id, user_id, status, verified_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'active', ?, ?, ?)
        """,
        (control_id, identity_id, user_id, TIMESTAMP, TIMESTAMP, TIMESTAMP),
    )
    await conn.execute(
        """
        INSERT INTO profile_atproto_links (
            id, entry_id, identity_id, status, verified_at,
            last_checked_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'verified', ?, ?, ?, ?)
        """,
        (link_id, entry_id, identity_id, TIMESTAMP, TIMESTAMP, TIMESTAMP, TIMESTAMP),
    )
    return control_id, link_id


async def _insert_atproto_claim_proof(
    conn: aiosqlite.Connection,
    *,
    suffix: str,
    entry_id: str,
    statuses: tuple[str, str],
    reviewed_at: str,
) -> tuple[str, str]:
    claim_status, proof_status = statuses
    claim_id = f"claim-{suffix}"
    proof_id = f"proof-{suffix}"
    await conn.execute(
        """
        INSERT INTO profile_claims (
            id, entry_id, user_id, user_email, status, tier,
            verified_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
        """,
        (
            claim_id,
            entry_id,
            f"user-{suffix}",
            f"{suffix}@example.com",
            claim_status,
            reviewed_at if claim_status == "verified" else None,
            reviewed_at,
            reviewed_at,
        ),
    )
    await conn.execute(
        """
        INSERT INTO profile_claim_proofs (
            id, claim_id, proof_type, proof_status, proof_summary,
            proof_metadata_json, created_at, reviewed_at
        ) VALUES (?, ?, 'atproto', ?, ?, ?, ?, ?)
        """,
        (
            proof_id,
            claim_id,
            proof_status,
            "ATProto evidence.",
            json.dumps({"did": "did:plc:proof", "handle": "proof.example"}),
            reviewed_at,
            reviewed_at,
        ),
    )
    return claim_id, proof_id


class _PausingSqliteConnection:
    def __init__(
        self,
        inner: aiosqlite.Connection,
        *,
        source_read_reached: asyncio.Event,
        resume_source_read: asyncio.Event,
    ) -> None:
        self._inner = inner
        self._source_read_reached = source_read_reached
        self._resume_source_read = resume_source_read

    @property
    def in_transaction(self) -> bool:
        return self._inner.in_transaction

    async def execute(
        self,
        statement: str,
        parameters: tuple[object, ...] = (),
    ) -> object:
        if "FROM entries ORDER BY updated_at DESC, id DESC" in " ".join(statement.split()):
            self._source_read_reached.set()
            await self._resume_source_read.wait()
        return await self._inner.execute(statement, parameters)

    async def commit(self) -> None:
        await self._inner.commit()

    async def rollback(self) -> None:
        await self._inner.rollback()


class TestEnsureEntryColumns:
    """Tests for the _ensure_entry_columns migration helper."""

    @pytest.mark.asyncio
    async def test_adds_full_address_column_when_missing(self) -> None:
        """Missing full_address column should be added by the migration."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.execute(
                """CREATE TABLE entries (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL
                )"""
            )
            await conn.commit()

            await _ensure_entry_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(entries)")
            rows = await cursor.fetchall()
            columns = {row[1] for row in rows}
            assert "full_address" in columns
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_column_already_exists(self) -> None:
        """The migration should be idempotent when full_address already exists."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.execute(
                """CREATE TABLE entries (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    full_address TEXT
                )"""
            )
            await conn.commit()

            await _ensure_entry_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(entries)")
            rows = await cursor.fetchall()
            columns = {row[1] for row in rows}
            assert "full_address" in columns
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_adds_geocode_columns_and_index_when_missing(self) -> None:
        """The migration should add the geocode columns and the lat/lng index."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.execute(
                """CREATE TABLE entries (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL
                )"""
            )
            await conn.commit()

            await _ensure_entry_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(entries)")
            rows = await cursor.fetchall()
            columns = {row[1] for row in rows}
            assert {
                "latitude",
                "longitude",
                "geocode_precision",
                "geocode_source",
            } <= columns

            index_cursor = await conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
                ("idx_entries_lat_lng",),
            )
            assert await index_cursor.fetchone() is not None
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_geocode_columns_when_already_present(self) -> None:
        """The migration should be idempotent when geocode columns already exist."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.execute(
                """CREATE TABLE entries (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    latitude REAL,
                    longitude REAL,
                    geocode_precision TEXT,
                    geocode_source TEXT
                )"""
            )
            await conn.commit()

            await _ensure_entry_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(entries)")
            rows = await cursor.fetchall()
            columns = {row[1] for row in rows}
            assert "geocode_source" in columns
        finally:
            await conn.close()


class TestEnsureOrgAnnotationColumns:
    """Tests for the org_annotations typed-target migration helper."""

    @pytest.mark.asyncio
    async def test_skips_when_table_missing(self) -> None:
        """Fresh databases should let the full schema create org_annotations."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await _ensure_org_annotation_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(org_annotations)")
            assert await cursor.fetchall() == []
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_rebuilds_legacy_not_null_entry_table(self) -> None:
        """Legacy entry-only notes should survive the nullable target migration."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.executescript(
                """
                CREATE TABLE entries (id TEXT PRIMARY KEY);
                CREATE TABLE sources (id TEXT PRIMARY KEY);
                INSERT INTO entries (id) VALUES ('entry-1');
                INSERT INTO sources (id) VALUES ('source-1');
                CREATE TABLE org_annotations (
                    id TEXT PRIMARY KEY,
                    org_id TEXT NOT NULL,
                    entry_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    author_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (entry_id) REFERENCES entries(id)
                );
                INSERT INTO org_annotations (
                    id, org_id, entry_id, content, author_id, created_at, updated_at
                ) VALUES (
                    'note-1', 'org-1', 'entry-1', 'Legacy note', 'user-1',
                    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
                );
                """
            )

            await _ensure_org_annotation_columns(conn)

            cursor = await conn.execute(
                """
                SELECT entry_id, source_id, target_type, target_id, content
                FROM org_annotations
                WHERE id = 'note-1'
                """
            )
            assert await cursor.fetchone() == (
                "entry-1",
                None,
                "entry",
                "entry-1",
                "Legacy note",
            )

            await conn.execute(
                """
                INSERT INTO org_annotations (
                    id, org_id, entry_id, source_id, target_type, target_id,
                    content, author_id, created_at, updated_at
                ) VALUES (
                    'note-2', 'org-1', NULL, 'source-1', 'source', 'source-1',
                    'Source note', 'user-1',
                    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
                )
                """
            )

            index_cursor = await conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
                ("idx_org_annotations_target",),
            )
            assert await index_cursor.fetchone() is not None
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_adds_missing_typed_target_columns(self) -> None:
        """Loose entry-note tables should gain source and typed target columns."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.executescript(
                """
                CREATE TABLE org_annotations (
                    id TEXT PRIMARY KEY,
                    org_id TEXT NOT NULL,
                    entry_id TEXT,
                    content TEXT NOT NULL,
                    author_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO org_annotations (
                    id, org_id, entry_id, content, author_id, created_at, updated_at
                ) VALUES (
                    'note-1', 'org-1', 'entry-1', 'Loose note', 'user-1',
                    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
                );
                """
            )

            await _ensure_org_annotation_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(org_annotations)")
            columns = {row[1] for row in await cursor.fetchall()}
            assert {"source_id", "target_type", "target_id"} <= columns

            note_cursor = await conn.execute(
                "SELECT target_type, target_id FROM org_annotations WHERE id = 'note-1'"
            )
            assert await note_cursor.fetchone() == ("entry", "entry-1")
        finally:
            await conn.close()


class TestEnsureDiscoveryRunColumns:
    """Tests for the discovery_runs research-output migration helper."""

    @pytest.mark.asyncio
    async def test_skips_when_table_missing(self) -> None:
        """Fresh databases should let the full schema create discovery_runs."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await _ensure_discovery_run_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(discovery_runs)")
            assert await cursor.fetchall() == []
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_adds_research_goal_and_summary_when_missing(self) -> None:
        """Existing run rows should gain goal and summary columns without data loss."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.executescript(
                """
                CREATE TABLE discovery_runs (
                    id TEXT PRIMARY KEY,
                    location_query TEXT NOT NULL,
                    state TEXT NOT NULL,
                    issue_areas TEXT NOT NULL,
                    started_at DATETIME NOT NULL,
                    status TEXT NOT NULL,
                    created_at DATETIME NOT NULL
                );
                INSERT INTO discovery_runs (
                    id, location_query, state, issue_areas, started_at, status, created_at
                ) VALUES (
                    'run-1', 'Austin, TX', 'TX', '["housing_affordability"]',
                    '2026-01-01T00:00:00Z', 'completed', '2026-01-01T00:00:00Z'
                );
                """
            )

            await _ensure_discovery_run_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(discovery_runs)")
            columns = {row[1] for row in await cursor.fetchall()}
            assert {"research_goal", "research_summary"} <= columns

            row_cursor = await conn.execute(
                """
                SELECT location_query, research_goal, research_summary
                FROM discovery_runs
                WHERE id = ?
                """,
                ("run-1",),
            )
            assert await row_cursor.fetchone() == ("Austin, TX", "landscape_scan", None)
        finally:
            await conn.close()


class TestEnsureDiscoveryJobColumns:
    """Tests for the discovery_jobs retry/idempotency migration helper."""

    @pytest.mark.asyncio
    async def test_skips_when_table_missing(self) -> None:
        """Fresh databases should let the full schema create discovery_jobs."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await _ensure_discovery_job_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(discovery_jobs)")
            assert await cursor.fetchall() == []
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_adds_job_metadata_columns_before_indexes_run(self) -> None:
        """Existing job rows should gain worker-routing columns before indexes execute."""
        conn = await aiosqlite.connect(":memory:")
        try:
            await conn.executescript(
                """
                CREATE TABLE discovery_jobs (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'queued',
                    progress TEXT,
                    error_message TEXT,
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    max_retries INTEGER NOT NULL DEFAULT 2,
                    claimed_by TEXT,
                    claimed_until DATETIME,
                    created_at DATETIME NOT NULL,
                    started_at DATETIME,
                    completed_at DATETIME,
                    updated_at DATETIME NOT NULL
                );
                INSERT INTO discovery_jobs (
                    id, run_id, status, created_at, updated_at
                ) VALUES (
                    'job-1', 'run-1', 'queued',
                    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
                );
                """
            )

            await _ensure_discovery_job_columns(conn)

            cursor = await conn.execute("PRAGMA table_info(discovery_jobs)")
            columns = {row[1] for row in await cursor.fetchall()}
            assert {
                "idempotency_key",
                "input_payload",
                "execution_mode",
                "next_attempt_at",
            } <= columns

            await conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_jobs_idempotency "
                "ON discovery_jobs(idempotency_key)"
            )
        finally:
            await conn.close()


class TestMigrateAtprotoIdentityGraph:
    """Behavioral coverage for the legacy user-owned identity migration."""

    @pytest.mark.asyncio
    async def test_sqlite_migration_blocks_writes_before_reading_source_rows(
        self,
        tmp_path: Path,
    ) -> None:
        """SQLite should reserve its write transaction before snapshotting legacy rows."""
        database_path = tmp_path / "sqlite-lock.db"
        setup_conn = await _legacy_database(database_path)
        try:
            await _insert_legacy_identity_link(
                setup_conn,
                key="lock",
                did="did:plc:lock",
                handle="lock.example",
            )
            await setup_conn.commit()
        finally:
            await setup_conn.close()

        migration_inner = await aiosqlite.connect(database_path, timeout=0.1)
        observer_conn = await aiosqlite.connect(database_path, timeout=0.1)
        source_read_reached = asyncio.Event()
        resume_source_read = asyncio.Event()
        migration_conn = _PausingSqliteConnection(
            migration_inner,
            source_read_reached=source_read_reached,
            resume_source_read=resume_source_read,
        )
        migration_task = asyncio.create_task(
            migrate_atproto_identity_graph(migration_conn, backend="sqlite")
        )
        write_error: Exception | None = None
        migration_error: Exception | None = None
        try:
            await asyncio.wait_for(source_read_reached.wait(), timeout=5)
            try:
                await observer_conn.execute(
                    "UPDATE entries SET updated_at = updated_at WHERE id = 'entry-lock'"
                )
                await asyncio.wait_for(observer_conn.commit(), timeout=1)
            except Exception as exc:  # noqa: BLE001 - assertion records the database error
                write_error = exc
        finally:
            await observer_conn.rollback()
            resume_source_read.set()
            try:
                await asyncio.wait_for(migration_task, timeout=5)
            except Exception as exc:  # noqa: BLE001 - re-raised after guaranteed cleanup
                migration_error = exc
            finally:
                await observer_conn.close()
                await migration_inner.close()
        if migration_error is not None:
            raise migration_error
        assert isinstance(write_error, aiosqlite.OperationalError)
        assert "database is locked" in str(write_error)

    @pytest.mark.asyncio
    async def test_preserves_single_owner_and_multiple_profile_links(
        self,
        tmp_path: Path,
    ) -> None:
        """One legacy owner should keep control and every represented profile."""
        database_path = tmp_path / "single-owner.db"
        conn = await _legacy_database(database_path)
        try:
            await conn.execute(
                """
                INSERT INTO atproto_identities (
                    id, user_id, did, current_handle, pds_url, did_resolved_at,
                    handle_verified_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "identity-preserved",
                    "user-one",
                    "did:plc:one",
                    "one.example",
                    "https://pds.example",
                    "2026-07-10T12:00:00+00:00",
                    "2026-07-11T12:00:00+00:00",
                    "2026-07-01T12:00:00+00:00",
                    TIMESTAMP,
                ),
            )
            await _insert_legacy_entry(
                conn,
                "entry-one",
                did="did:plc:one",
                handle="one.example",
                verified_at="2026-07-11T12:00:00+00:00",
            )
            await _insert_legacy_entry(
                conn,
                "entry-two",
                did="did:plc:one",
                handle="one.example",
                verified_at="2026-07-11T13:00:00+00:00",
            )
            await conn.execute(
                """
                INSERT INTO profile_claims (
                    id, entry_id, user_id, user_email, status, tier,
                    verified_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'verified', 1, ?, ?, ?)
                """,
                (
                    "claim-preserved",
                    "entry-one",
                    "user-one",
                    "one@example.com",
                    TIMESTAMP,
                    TIMESTAMP,
                    TIMESTAMP,
                ),
            )
            await conn.execute(
                """
                INSERT INTO profile_claim_proofs (
                    id, claim_id, proof_type, proof_status, proof_summary,
                    proof_metadata_json, created_at, reviewed_at
                ) VALUES (?, ?, 'atproto', 'verified', ?, ?, ?, ?)
                """,
                (
                    "proof-preserved",
                    "claim-preserved",
                    "Verified ATProto identity.",
                    json.dumps({"did": "did:plc:one", "handle": "one.example"}),
                    TIMESTAMP,
                    TIMESTAMP,
                ),
            )
            await conn.commit()
        finally:
            await conn.close()

        db_url = f"sqlite:///{database_path}"
        await init_db(db_url)

        conn = await aiosqlite.connect(database_path)
        try:
            identity_cursor = await conn.execute(
                """
                SELECT id, did, current_handle, pds_url, resolution_status,
                       did_resolved_at, handle_verified_at
                FROM atproto_identities
                """
            )
            assert await identity_cursor.fetchall() == [
                (
                    "identity-preserved",
                    "did:plc:one",
                    "one.example",
                    "https://pds.example",
                    "verified",
                    "2026-07-10T12:00:00+00:00",
                    "2026-07-11T12:00:00+00:00",
                )
            ]

            control_cursor = await conn.execute(
                """
                SELECT id, identity_id, user_id, status, verified_at
                FROM user_atproto_controls
                """
            )
            controls = await control_cursor.fetchall()
            assert len(controls) == 1
            control_id, identity_id, user_id, status, verified_at = controls[0]
            assert UUID(control_id).version == 5
            assert (identity_id, user_id, status, verified_at) == (
                "identity-preserved",
                "user-one",
                "active",
                "2026-07-11T12:00:00+00:00",
            )

            link_cursor = await conn.execute(
                """
                SELECT id, entry_id, identity_id, claim_id, proof_id, status, verified_at
                FROM profile_atproto_links
                ORDER BY entry_id
                """
            )
            links = await link_cursor.fetchall()
            assert [UUID(link[0]).version for link in links] == [5, 5]
            assert [link[1:] for link in links] == [
                (
                    "entry-one",
                    "identity-preserved",
                    "claim-preserved",
                    "proof-preserved",
                    "verified",
                    "2026-07-11T12:00:00+00:00",
                ),
                (
                    "entry-two",
                    "identity-preserved",
                    None,
                    None,
                    "verified",
                    "2026-07-11T13:00:00+00:00",
                ),
            ]

            entry_cursor = await conn.execute("PRAGMA table_info(entries)")
            entry_columns = {str(row[1]) for row in await entry_cursor.fetchall()}
            assert LEGACY_ATPROTO_COLUMNS.isdisjoint(entry_columns)
            index_cursor = await conn.execute(
                """
                SELECT name FROM sqlite_master
                WHERE type = 'index' AND name IN (
                    'idx_atproto_identities_user', 'idx_atproto_identities_did'
                )
                """
            )
            assert await index_cursor.fetchall() == []

            rows_before_second_init = {}
            for table in (
                "atproto_identities",
                "user_atproto_controls",
                "profile_atproto_links",
            ):
                cursor = await conn.execute(f"SELECT * FROM {table} ORDER BY id")
                rows_before_second_init[table] = await cursor.fetchall()
        finally:
            await conn.close()

        await init_db(db_url)

        conn = await aiosqlite.connect(database_path)
        try:
            for table, expected_rows in rows_before_second_init.items():
                cursor = await conn.execute(f"SELECT * FROM {table} ORDER BY id")
                assert await cursor.fetchall() == expected_rows
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_duplicate_did_uses_newest_identity_and_marks_every_control_conflict(
        self,
        tmp_path: Path,
    ) -> None:
        """Competing legacy owners should not receive an arbitrary active winner."""
        database_path = tmp_path / "conflict.db"
        conn = await _legacy_database(database_path)
        try:
            await conn.executemany(
                """
                INSERT INTO atproto_identities (
                    id, user_id, did, current_handle, pds_url, did_resolved_at,
                    handle_verified_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        "identity-older",
                        "user-one",
                        "did:plc:shared",
                        "old.example",
                        "https://old-pds.example",
                        "2026-07-01T12:00:00+00:00",
                        "2026-07-01T12:00:00+00:00",
                        "2026-07-01T12:00:00+00:00",
                        "2026-07-02T12:00:00+00:00",
                    ),
                    (
                        "identity-newest",
                        "user-two",
                        "did:plc:shared",
                        "new.example",
                        "https://new-pds.example",
                        "2026-07-10T12:00:00+00:00",
                        "2026-07-10T12:00:00+00:00",
                        "2026-07-03T12:00:00+00:00",
                        "2026-07-11T12:00:00+00:00",
                    ),
                ],
            )
            await conn.commit()
        finally:
            await conn.close()

        await init_db(f"sqlite:///{database_path}")

        conn = await aiosqlite.connect(database_path)
        try:
            identity_cursor = await conn.execute(
                "SELECT id, current_handle, pds_url FROM atproto_identities"
            )
            assert await identity_cursor.fetchall() == [
                ("identity-newest", "new.example", "https://new-pds.example")
            ]
            controls_cursor = await conn.execute(
                """
                SELECT user_id, status
                FROM user_atproto_controls
                ORDER BY user_id
                """
            )
            assert await controls_cursor.fetchall() == [
                ("user-one", "conflict"),
                ("user-two", "conflict"),
            ]
            active_cursor = await conn.execute(
                "SELECT COUNT(*) FROM user_atproto_controls WHERE status = 'active'"
            )
            assert await active_cursor.fetchone() == (0,)
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_complete_unmatched_profile_identity_requires_reverification(
        self,
        tmp_path: Path,
    ) -> None:
        """A complete legacy pair without identity provenance should remain visible to review."""
        database_path = tmp_path / "unresolved.db"
        conn = await _legacy_database(database_path)
        try:
            await _insert_legacy_entry(
                conn,
                "entry-unresolved",
                did="did:plc:unresolved",
                handle="unresolved.example",
                verified_at="2026-07-08T12:00:00+00:00",
            )
            await conn.commit()
        finally:
            await conn.close()

        await init_db(f"sqlite:///{database_path}")

        conn = await aiosqlite.connect(database_path)
        try:
            identity_cursor = await conn.execute(
                """
                SELECT id, did, current_handle, resolution_status,
                       did_resolved_at, handle_verified_at
                FROM atproto_identities
                """
            )
            identity = await identity_cursor.fetchone()
            assert identity is not None
            assert UUID(identity[0]).version == 5
            assert identity[1:] == (
                "did:plc:unresolved",
                "unresolved.example",
                "needs_attention",
                None,
                None,
            )
            link_cursor = await conn.execute(
                """
                SELECT entry_id, identity_id, status, verified_at
                FROM profile_atproto_links
                """
            )
            assert await link_cursor.fetchone() == (
                "entry-unresolved",
                identity[0],
                "reverification_required",
                "2026-07-08T12:00:00+00:00",
            )
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_partial_graph_rows_survive_with_final_foreign_keys(
        self,
        tmp_path: Path,
    ) -> None:
        """A partial deployment should preserve child rows and repair their parent FKs."""
        database_path = tmp_path / "partial-graph.db"
        conn = await _legacy_database(database_path)
        try:
            await conn.execute("PRAGMA foreign_keys = ON")
            identity_id, user_id, entry_id = await _insert_legacy_identity_link(
                conn,
                key="partial-graph",
                did="did:plc:partial-graph",
                handle="partial.example",
                pds_url="https://pds.example",
            )
            control_id, link_id = await _create_partial_atproto_graph(
                conn,
                identity_id=identity_id,
                user_id=user_id,
                entry_id=entry_id,
            )
            await conn.commit()
        finally:
            await conn.close()

        db_url = f"sqlite:///{database_path}"
        await init_db(db_url)

        conn = await aiosqlite.connect(database_path)
        try:
            await conn.execute("PRAGMA foreign_keys = ON")
            control_cursor = await conn.execute(
                """
                SELECT id, identity_id, user_id, status
                FROM user_atproto_controls
                """
            )
            assert await control_cursor.fetchall() == [(control_id, identity_id, user_id, "active")]
            link_cursor = await conn.execute(
                """
                SELECT id, entry_id, identity_id, status
                FROM profile_atproto_links
                """
            )
            assert await link_cursor.fetchall() == [
                (
                    link_id,
                    entry_id,
                    identity_id,
                    "verified",
                )
            ]

            control_fk_cursor = await conn.execute("PRAGMA foreign_key_list(user_atproto_controls)")
            control_fk_targets = {str(row[2]) for row in await control_fk_cursor.fetchall()}
            assert control_fk_targets == {"atproto_identities"}
            link_fk_cursor = await conn.execute("PRAGMA foreign_key_list(profile_atproto_links)")
            link_fk_targets = {str(row[2]) for row in await link_fk_cursor.fetchall()}
            assert "atproto_identities" in link_fk_targets
            assert "atproto_identities_legacy" not in link_fk_targets
            fk_check_cursor = await conn.execute("PRAGMA foreign_key_check")
            assert await fk_check_cursor.fetchall() == []
            archive_cursor = await conn.execute(
                """
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name = 'atproto_identities_legacy'
                """
            )
            assert await archive_cursor.fetchone() is None
        finally:
            await conn.close()

        await init_db(db_url)

        conn = await aiosqlite.connect(database_path)
        try:
            control_cursor = await conn.execute("SELECT id FROM user_atproto_controls")
            assert await control_cursor.fetchall() == [(control_id,)]
            link_cursor = await conn.execute("SELECT id FROM profile_atproto_links")
            assert await link_cursor.fetchall() == [(link_id,)]
        finally:
            await conn.close()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("claim_status", "proof_status"),
        [
            ("pending", "verified"),
            ("rejected", "verified"),
            ("revoked", "verified"),
            ("verified", "pending"),
            ("verified", "rejected"),
            ("verified", "revoked"),
        ],
    )
    async def test_unverified_claim_or_proof_is_not_profile_link_support(
        self,
        tmp_path: Path,
        claim_status: str,
        proof_status: str,
    ) -> None:
        """Unverified evidence should never support a migrated verified profile link."""
        database_path = tmp_path / "unverified-proof.db"
        conn = await _legacy_database(database_path)
        try:
            await _insert_legacy_identity_link(
                conn,
                key="proof",
                did="did:plc:proof",
                handle="proof.example",
            )
            await _insert_atproto_claim_proof(
                conn,
                suffix="unverified",
                entry_id="entry-proof",
                statuses=(claim_status, proof_status),
                reviewed_at=TIMESTAMP,
            )
            await conn.commit()
        finally:
            await conn.close()

        await init_db(f"sqlite:///{database_path}")

        conn = await aiosqlite.connect(database_path)
        try:
            link_cursor = await conn.execute(
                "SELECT status, claim_id, proof_id FROM profile_atproto_links"
            )
            assert await link_cursor.fetchone() == ("verified", None, None)
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_newest_verified_claim_and_proof_support_profile_link(
        self,
        tmp_path: Path,
    ) -> None:
        """Mixed evidence should select the newest verified claim and verified proof."""
        database_path = tmp_path / "mixed-proofs.db"
        conn = await _legacy_database(database_path)
        try:
            await _insert_legacy_identity_link(
                conn,
                key="proof",
                did="did:plc:proof",
                handle="proof.example",
            )
            await _insert_atproto_claim_proof(
                conn,
                suffix="verified-old",
                entry_id="entry-proof",
                statuses=("verified", "verified"),
                reviewed_at="2026-07-09T12:00:00+00:00",
            )
            expected = await _insert_atproto_claim_proof(
                conn,
                suffix="verified-new",
                entry_id="entry-proof",
                statuses=("verified", "verified"),
                reviewed_at="2026-07-10T12:00:00+00:00",
            )
            await _insert_atproto_claim_proof(
                conn,
                suffix="rejected-newest",
                entry_id="entry-proof",
                statuses=("rejected", "verified"),
                reviewed_at="2026-07-12T12:00:00+00:00",
            )
            await _insert_atproto_claim_proof(
                conn,
                suffix="pending-newest",
                entry_id="entry-proof",
                statuses=("verified", "pending"),
                reviewed_at="2026-07-13T12:00:00+00:00",
            )
            await conn.commit()
        finally:
            await conn.close()

        await init_db(f"sqlite:///{database_path}")

        conn = await aiosqlite.connect(database_path)
        try:
            link_cursor = await conn.execute(
                "SELECT status, claim_id, proof_id FROM profile_atproto_links"
            )
            assert await link_cursor.fetchone() == ("verified", *expected)
        finally:
            await conn.close()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("did", "handle", "verified_at"),
        [
            ("did:plc:partial", None, None),
            (None, "partial.example", None),
            (None, None, "2026-07-08T12:00:00+00:00"),
        ],
    )
    async def test_corrupt_partial_profile_identity_rolls_back(
        self,
        tmp_path: Path,
        did: str | None,
        handle: str | None,
        verified_at: str | None,
    ) -> None:
        """Partial legacy identity data should fail instead of inventing trusted provenance."""
        database_path = tmp_path / "partial.db"
        conn = await _legacy_database(database_path)
        try:
            await conn.execute(
                """
                INSERT INTO atproto_identities (
                    id, user_id, did, current_handle, pds_url, did_resolved_at,
                    handle_verified_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)
                """,
                (
                    "identity-still-legacy",
                    "user-one",
                    "did:plc:one",
                    "one.example",
                    TIMESTAMP,
                    TIMESTAMP,
                    TIMESTAMP,
                    TIMESTAMP,
                ),
            )
            await _insert_legacy_entry(
                conn,
                "entry-partial",
                did=did,
                handle=handle,
                verified_at=verified_at,
            )
            await conn.commit()
        finally:
            await conn.close()

        with pytest.raises(
            RuntimeError,
            match="Corrupt legacy ATProto link for entry entry-partial",
        ):
            await init_db(f"sqlite:///{database_path}")

        conn = await aiosqlite.connect(database_path)
        try:
            identity_columns_cursor = await conn.execute("PRAGMA table_info(atproto_identities)")
            identity_columns = {str(row[1]) for row in await identity_columns_cursor.fetchall()}
            assert "user_id" in identity_columns
            legacy_identity_cursor = await conn.execute(
                "SELECT id FROM atproto_identities WHERE id = 'identity-still-legacy'"
            )
            assert await legacy_identity_cursor.fetchone() == ("identity-still-legacy",)

            entry_columns_cursor = await conn.execute("PRAGMA table_info(entries)")
            entry_columns = {str(row[1]) for row in await entry_columns_cursor.fetchall()}
            assert entry_columns >= LEGACY_ATPROTO_COLUMNS

            table_cursor = await conn.execute(
                """
                SELECT name FROM sqlite_master
                WHERE type = 'table'
                  AND name IN ('user_atproto_controls', 'profile_atproto_links')
                """
            )
            assert await table_cursor.fetchall() == []
        finally:
            await conn.close()
