"""ATProto identity-graph schema created by database initialization."""

from __future__ import annotations

import sys
from types import SimpleNamespace
from typing import TYPE_CHECKING

import aiosqlite
import pytest

from atlas.models import database as database_module
from atlas.models import init_db
from atlas.models.database import _init_postgres, _load_postgres_schema

if TYPE_CHECKING:
    from pathlib import Path

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
