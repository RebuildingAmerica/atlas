"""ATProto profile-linking schema created by database initialization."""

from __future__ import annotations

import tempfile

import aiosqlite
import pytest

from atlas.models import init_db
from atlas.models.database import _load_postgres_schema


@pytest.mark.asyncio
async def test_init_db_creates_atproto_identity_storage() -> None:
    """Fresh SQLite databases should include ATProto profile-linking storage."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as database:
        db_url = f"sqlite:///{database.name}"

    await init_db(db_url)

    conn = await aiosqlite.connect(database.name)
    try:
        table_cursor = await conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='atproto_identities'"
        )
        assert await table_cursor.fetchone() == ("atproto_identities",)

        entry_cursor = await conn.execute("PRAGMA table_info(entries)")
        entry_columns = {row[1] for row in await entry_cursor.fetchall()}
        assert {
            "linked_atproto_did",
            "linked_atproto_handle",
            "linked_atproto_verified_at",
        } <= entry_columns

        index_cursor = await conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name IN (?, ?)",
            ("idx_atproto_identities_user", "idx_atproto_identities_did"),
        )
        assert {row[0] for row in await index_cursor.fetchall()} == {
            "idx_atproto_identities_user",
            "idx_atproto_identities_did",
        }
    finally:
        await conn.close()


def test_postgres_schema_includes_atproto_profile_linking_storage() -> None:
    """Production schema loading should include ATProto profile-linking storage."""
    schema = _load_postgres_schema()

    assert "CREATE TABLE IF NOT EXISTS atproto_identities" in schema
    assert "linked_atproto_handle" in schema
    assert "idx_atproto_identities_user" in schema
