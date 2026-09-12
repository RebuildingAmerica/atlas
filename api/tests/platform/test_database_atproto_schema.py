"""ATProto identity-graph schema created by database initialization."""

from __future__ import annotations

from typing import TYPE_CHECKING

import aiosqlite
import pytest

from atlas.models import init_db
from tests.platform.atproto_schema_support import (
    CONTROL_COLUMNS,
    IDENTITY_COLUMNS,
    LEGACY_ENTRY_COLUMNS,
    PROFILE_LINK_COLUMNS,
    _columns,
)

if TYPE_CHECKING:
    from pathlib import Path


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
