"""The limit caps the payload and reports when the viewport overflows."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from atlas.domains.catalog.models.entry import EntryCRUD

from .support import _THREE, _TWO, _US_BBOX, _place

if TYPE_CHECKING:
    import aiosqlite

pytestmark = pytest.mark.asyncio


class TestCap:
    """The limit caps the payload and reports when the viewport overflows."""

    async def test_capped_true_when_total_exceeds_limit(
        self, test_db: aiosqlite.Connection
    ) -> None:
        for index in range(_THREE):
            await _place(test_db, name=f"Org {index}")

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=_TWO)

        assert len(result["points"]) == _TWO
        assert result["total"] == _THREE
        assert result["capped"] is True

    async def test_capped_false_when_within_limit(self, test_db: aiosqlite.Connection) -> None:
        for index in range(_TWO):
            await _place(test_db, name=f"Org {index}")

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=_TWO)

        assert len(result["points"]) == _TWO
        assert result["total"] == _TWO
        assert result["capped"] is False
