"""trust_level mirrors the canonical app-wide trust tiers."""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

import pytest

from atlas.domains.catalog.models.entry import EntryCRUD

from .support import _US_BBOX, _link_source, _place

if TYPE_CHECKING:
    import aiosqlite

pytestmark = pytest.mark.asyncio


class TestTrustLevel:
    """trust_level mirrors the canonical app-wide trust tiers."""

    async def test_verified_entry_is_atlas_verified(self, test_db: aiosqlite.Connection) -> None:
        await _place(test_db, name="Verified Org", verified=True)

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=2000)

        assert result["points"][0]["trust_level"] == "atlas_verified"

    async def test_two_source_domains_are_corroborated(self, test_db: aiosqlite.Connection) -> None:
        entry_id = await _place(test_db, name="Corroborated Org")
        await _link_source(test_db, entry_id, "https://one.example.com/a")
        await _link_source(test_db, entry_id, "https://two.example.org/b")

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=2000)

        assert result["points"][0]["trust_level"] == "corroborated"

    async def test_single_source_domain_is_unverified(self, test_db: aiosqlite.Connection) -> None:
        entry_id = await _place(test_db, name="Thin Org")
        await _link_source(test_db, entry_id, "https://one.example.com/a")
        await _link_source(test_db, entry_id, "https://one.example.com/b")

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=2000)

        assert result["points"][0]["trust_level"] == "unverified"

    async def test_suppressed_sources_do_not_inflate_public_map_facts(
        self, test_db: aiosqlite.Connection
    ) -> None:
        entry_id = await _place(test_db, name="Suppressed Source Org")
        await _link_source(
            test_db,
            entry_id,
            "https://visible.example.com/a",
            published_date=date(2026, 4, 1),
        )
        hidden_source_id = await _link_source(
            test_db,
            entry_id,
            "https://hidden.example.org/a",
            published_date=date(2026, 5, 4),
        )
        await EntryCRUD.update(test_db, entry_id, suppressed_source_ids=[hidden_source_id])

        result = await EntryCRUD.search_map_points(test_db, **_US_BBOX, limit=2000)

        point = result["points"][0]
        assert point["source_count"] == 1
        assert point["latest_source_date"] == "2026-04-01"
        assert point["trust_level"] == "unverified"
