"""Pytest fixtures for ScoutStore tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from atlas_scout.store import ScoutStore

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


@pytest.fixture
async def store(tmp_db_path: object) -> AsyncIterator[ScoutStore]:
    s = ScoutStore(str(tmp_db_path))
    await s.initialize()
    yield s
    await s.close()
