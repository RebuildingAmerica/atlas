"""Tests for Step 5: rank."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from atlas_shared import DeduplicatedEntry, RankedEntry
from atlas_scout.steps.rank import rank_entries_stream


def _make_dedup(
    name: str = "Test Org",
    source_urls: list[str] | None = None,
    website: str | None = None,
    email: str | None = None,
    geo_specificity: str = "local",
    description: str = "A description with some words in it.",
    issue_areas: list[str] | None = None,
) -> DeduplicatedEntry:
    return DeduplicatedEntry(
        name=name,
        entry_type="organization",
        description=description,
        city="Austin",
        state="TX",
        geo_specificity=geo_specificity,
        issue_areas=issue_areas or ["housing_affordability"],
        source_urls=source_urls or [],
        website=website,
        email=email,
    )


async def _entries_iter(*entries: DeduplicatedEntry) -> AsyncIterator[DeduplicatedEntry]:
    for entry in entries:
        yield entry


@pytest.mark.asyncio
async def test_well_sourced_entry_scores_higher_than_sparse() -> None:
    """An entry with more sources and contact info ranks higher than one with fewer."""
    well_sourced = _make_dedup(
        name="Well Sourced Org",
        source_urls=["https://a.com", "https://b.com", "https://c.com", "https://d.com"],
        website="https://wellsourced.org",
        email="info@wellsourced.org",
        description="A long and detailed description about this organization " * 3,
        issue_areas=["housing_affordability", "union_organizing", "energy_transition"],
    )
    sparse = _make_dedup(
        name="Sparse Org",
        source_urls=[],
        website=None,
        email=None,
        description="Brief.",
        issue_areas=["housing_affordability"],
    )

    results = [r async for r in rank_entries_stream(_entries_iter(well_sourced, sparse))]

    assert len(results) == 2
    # First result should be the well-sourced entry
    assert results[0].entry.name == "Well Sourced Org"
    assert results[0].score > results[1].score


@pytest.mark.asyncio
async def test_filters_below_threshold() -> None:
    """Entries with score below min_score are excluded from results."""
    sparse = _make_dedup(
        name="Very Sparse",
        source_urls=[],
        website=None,
        email=None,
        description=".",
        issue_areas=[],
    )

    # With min_score=0.5, a sparse entry (score near 0) should be filtered out
    results = [r async for r in rank_entries_stream(_entries_iter(sparse), min_score=0.5)]

    assert results == []


@pytest.mark.asyncio
async def test_scores_are_between_zero_and_one() -> None:
    """All scored entries have scores in the [0, 1] range."""
    entries = [
        _make_dedup(
            name=f"Org {i}",
            source_urls=[f"https://source{j}.com" for j in range(i)],
            website="https://org.org" if i > 1 else None,
        )
        for i in range(5)
    ]

    results = [r async for r in rank_entries_stream(_entries_iter(*entries))]

    for r in results:
        assert 0.0 <= r.score <= 1.0


@pytest.mark.asyncio
async def test_results_are_sorted_descending() -> None:
    """Results are yielded in descending score order."""
    entries = [
        _make_dedup(name="A", source_urls=["https://a.com"] * 4, website="https://a.com", email="a@a.com"),
        _make_dedup(name="B", source_urls=[], website=None),
        _make_dedup(name="C", source_urls=["https://c.com"], website="https://c.com"),
    ]

    results = [r async for r in rank_entries_stream(_entries_iter(*entries))]
    scores = [r.score for r in results]

    assert scores == sorted(scores, reverse=True)
