"""Tests for Step 4: dedup."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from atlas_shared import RawEntry

from atlas_scout.steps.dedup import deduplicate_stream

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


def _make_raw(
    name: str,
    city: str = "Austin",
    state: str = "TX",
    entry_type: str = "organization",
    description: str = "Short.",
    source_url: str = "https://source.example.com",
    issue_areas: list[str] | None = None,
) -> RawEntry:
    return RawEntry(
        name=name,
        entry_type=entry_type,
        description=description,
        city=city,
        state=state,
        issue_areas=issue_areas or ["housing_affordability"],
        source_url=source_url,
    )


async def _entries_iter(*entries: RawEntry) -> AsyncIterator[RawEntry]:
    for entry in entries:
        yield entry


@pytest.mark.asyncio
async def test_merges_exact_duplicates() -> None:
    """Exact name + city + type produces a single merged entry."""
    a = _make_raw("Housing First", description="Short desc.", source_url="https://a.example.com")
    b = _make_raw(
        "Housing First",
        description="A much longer description that should win.",
        source_url="https://b.example.com",
    )

    results = [e async for e in deduplicate_stream(_entries_iter(a, b))]

    assert len(results) == 1
    assert results[0].name == "Housing First"
    # Longer description kept
    assert results[0].description == "A much longer description that should win."
    # Both source URLs combined
    assert set(results[0].source_urls) == {"https://a.example.com", "https://b.example.com"}


@pytest.mark.asyncio
async def test_keeps_distinct_entries_separate() -> None:
    """Entries with clearly different names are not merged."""
    a = _make_raw("Housing First Austin", source_url="https://a.example.com")
    b = _make_raw("Tenant Power Network", source_url="https://b.example.com")

    results = [e async for e in deduplicate_stream(_entries_iter(a, b))]

    assert len(results) == 2
    names = {r.name for r in results}
    assert "Housing First Austin" in names
    assert "Tenant Power Network" in names


@pytest.mark.asyncio
async def test_merges_similar_names_same_city() -> None:
    """Names with ≥0.9 similarity in the same city are auto-merged."""
    a = _make_raw("Housing First ATX", source_url="https://a.example.com")
    # Similarity to "Housing First ATX" should be ≥ 0.9
    b = _make_raw("Housing First ATX", source_url="https://b.example.com")

    results = [e async for e in deduplicate_stream(_entries_iter(a, b))]

    assert len(results) == 1


@pytest.mark.asyncio
async def test_combines_issue_areas_on_merge() -> None:
    """Merged entries have the union of issue areas from both sources."""
    a = _make_raw("Test Org", issue_areas=["housing_affordability"], source_url="https://a.example.com")
    b = _make_raw("Test Org", issue_areas=["union_organizing"], source_url="https://b.example.com")

    results = [e async for e in deduplicate_stream(_entries_iter(a, b))]

    assert len(results) == 1
    assert set(results[0].issue_areas) == {"housing_affordability", "union_organizing"}


@pytest.mark.asyncio
async def test_different_cities_not_merged() -> None:
    """Entries with the same name but different cities are kept separate."""
    a = _make_raw("Housing First", city="Austin")
    b = _make_raw("Housing First", city="Dallas")

    results = [e async for e in deduplicate_stream(_entries_iter(a, b))]

    assert len(results) == 2
