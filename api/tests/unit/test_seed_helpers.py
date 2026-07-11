"""Tests for seed helper failure paths."""

from __future__ import annotations

from datetime import date

import pytest

from atlas import seed_profiles_support
from atlas.seed_briefing_room_demo_support import (
    _get_required_entry,
    _source_receipts_for_entries,
    _source_stats_for_entry,
)
from atlas.seed_profiles_support import SeedEntry, _place_seed_entry


@pytest.mark.asyncio
async def test_briefing_room_demo_seed_helpers_fail_loudly_for_missing_data(
    test_db: object,
) -> None:
    with pytest.raises(RuntimeError, match="Required demo profile is missing"):
        await _get_required_entry(test_db, "missing-profile")

    with pytest.raises(RuntimeError, match="Required demo source receipts are missing"):
        await _source_receipts_for_entries(test_db, ["missing-entry"])


@pytest.mark.asyncio
async def test_source_stats_handles_missing_cursor_row() -> None:
    class Cursor:
        async def fetchone(self) -> None:
            return None

    class FakeConnection:
        async def execute(self, *_args: object, **_kwargs: object) -> Cursor:
            return Cursor()

    stats = await _source_stats_for_entry(FakeConnection(), "entry-missing")

    assert stats.source_count == 0
    assert stats.latest_source_date is None


@pytest.mark.asyncio
async def test_place_seed_entry_skips_unmatched_geocode(
    test_db: object,
    sample_entry: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def no_geocode(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(seed_profiles_support, "geocode_entry", no_geocode)
    seed = SeedEntry(
        slug="sample",
        entry_type="organization",
        name="Sample",
        description="Sample civic actor.",
        city="Missing",
        state="ZZ",
        region=None,
        geo_specificity="local",
        website=None,
        email=None,
        phone=None,
        social_media=None,
        affiliated_org_slug=None,
        verified=False,
        last_verified=None,
        first_seen=date(2026, 1, 1),
        last_seen=date(2026, 1, 1),
        issue_areas=(),
        sources=(),
    )

    await _place_seed_entry(test_db, sample_entry, seed)
