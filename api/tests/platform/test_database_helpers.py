"""Tests for the platform-level database delegating wrappers."""

from __future__ import annotations

import re

import pytest

from atlas.platform.database import (
    DatabaseManager,
    db,
    get_db_connection,
    init_db,
)


class TestDatabaseManager:
    def test_generate_uuid_returns_uuid_format(self) -> None:
        value = DatabaseManager.generate_uuid()
        assert re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", value)

    def test_now_iso_returns_timezone_aware_iso_string(self) -> None:
        value = DatabaseManager.now_iso()
        assert "T" in value
        assert value.endswith("+00:00")

    def test_encode_decode_roundtrip(self) -> None:
        encoded = DatabaseManager.encode_json({"k": [1, 2, 3]})
        assert DatabaseManager.decode_json(encoded) == {"k": [1, 2, 3]}

    def test_module_singleton_is_a_database_manager(self) -> None:
        assert isinstance(db, DatabaseManager)


class TestPlatformDatabaseDelegation:
    @pytest.mark.asyncio
    async def test_init_and_connect_via_platform_module(self, tmp_db_path: str) -> None:
        url = f"sqlite:///{tmp_db_path}"

        await init_db(url)
        conn = await get_db_connection(url)
        try:
            cursor = await conn.execute("SELECT 1")
            row = await cursor.fetchone()
            assert row[0] == 1
        finally:
            await conn.close()
