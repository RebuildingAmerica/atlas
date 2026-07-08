"""Tests for the schedule module database dependency."""

from __future__ import annotations

import pytest

from atlas.domains.discovery import api_schedule
from atlas.models import init_db
from atlas.platform.config import Settings


@pytest.mark.asyncio
async def test_get_db_dependency_yields_and_closes_connection(tmp_db_path: str) -> None:
    """The get_db FastAPI dependency yields a connection and tears it down on exit."""
    settings = Settings(database_url=f"sqlite:///{tmp_db_path}", deploy_mode="local")
    await init_db(settings.database_url)

    agen = api_schedule.get_db(settings=settings)
    conn = await agen.__anext__()
    cursor = await conn.execute("SELECT 1")
    row = await cursor.fetchone()
    assert row[0] == 1
    with pytest.raises(StopAsyncIteration):
        await agen.__anext__()
