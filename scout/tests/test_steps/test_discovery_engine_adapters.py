"""Tests for the Scout dedup/rank adapters around atlas_discovery_engine."""

from __future__ import annotations

from typing import TYPE_CHECKING

import atlas_discovery_engine.dedup as shared_dedup
import pytest
from atlas_shared import DeduplicatedEntry, RawEntry

from atlas_scout.steps.discovery_engine_adapters import deduplicate_stream, rank_entries_stream

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


async def _raw_entries_iter(*entries: RawEntry) -> AsyncIterator[RawEntry]:
    for entry in entries:
        yield entry


async def _dedup_entries_iter(*entries: DeduplicatedEntry) -> AsyncIterator[DeduplicatedEntry]:
    for entry in entries:
        yield entry


# ---------------------------------------------------------------------------
# deduplicate_stream
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_merges_exact_duplicates() -> None:
    """Exact name + city + type produces a single merged entry."""
    a = _make_raw("Housing First", description="Short desc.", source_url="https://a.example.com")
    b = _make_raw(
        "Housing First",
        description="A much longer description that should win.",
        source_url="https://b.example.com",
    )

    results = [e async for e in deduplicate_stream(_raw_entries_iter(a, b))]

    assert len(results) == 1
    assert results[0].name == "Housing First"
    # Longer description kept
    assert results[0].description == "A much longer description that should win."
    # Both source URLs combined
    assert set(results[0].source_urls) == {"https://a.example.com", "https://b.example.com"}


@pytest.mark.asyncio
async def test_deduplicate_stream_uses_index_for_exact_people_matches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Large structured runs should not compare every person against every prior row."""
    calls = 0
    original_match_type = shared_dedup._match_type

    def counting_match_type(**kwargs: object) -> str | None:
        nonlocal calls
        calls += 1
        return original_match_type(**kwargs)

    monkeypatch.setattr(shared_dedup, "_match_type", counting_match_type)
    entries = [
        _make_raw(
            f"Person {index}",
            city="Austin",
            entry_type="person",
            source_url=f"https://source.example.com/{index}",
        )
        for index in range(300)
    ]
    entries.append(
        _make_raw(
            "Person 42",
            city="Austin",
            entry_type="person",
            source_url="https://source.example.com/duplicate",
        )
    )

    results = [e async for e in deduplicate_stream(_raw_entries_iter(*entries))]

    assert len(results) == 300
    assert calls < 1000


@pytest.mark.asyncio
async def test_keeps_distinct_entries_separate() -> None:
    """Entries with clearly different names are not merged."""
    a = _make_raw("Housing First Austin", source_url="https://a.example.com")
    b = _make_raw("Tenant Power Network", source_url="https://b.example.com")

    results = [e async for e in deduplicate_stream(_raw_entries_iter(a, b))]

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

    results = [e async for e in deduplicate_stream(_raw_entries_iter(a, b))]

    assert len(results) == 1


@pytest.mark.asyncio
async def test_combines_issue_areas_on_merge() -> None:
    """Merged entries have the union of issue areas from both sources."""
    a = _make_raw(
        "Test Org", issue_areas=["housing_affordability"], source_url="https://a.example.com"
    )
    b = _make_raw("Test Org", issue_areas=["union_organizing"], source_url="https://b.example.com")

    results = [e async for e in deduplicate_stream(_raw_entries_iter(a, b))]

    assert len(results) == 1
    assert set(results[0].issue_areas) == {"housing_affordability", "union_organizing"}


@pytest.mark.asyncio
async def test_different_cities_not_merged() -> None:
    """Entries with the same name but different cities are kept separate."""
    a = _make_raw("Housing First", city="Austin")
    b = _make_raw("Housing First", city="Dallas")

    results = [e async for e in deduplicate_stream(_raw_entries_iter(a, b))]

    assert len(results) == 2


# ---------------------------------------------------------------------------
# rank_entries_stream
# ---------------------------------------------------------------------------


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

    results = [r async for r in rank_entries_stream(_dedup_entries_iter(well_sourced, sparse))]

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
    results = [r async for r in rank_entries_stream(_dedup_entries_iter(sparse), min_score=0.5)]

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

    results = [r async for r in rank_entries_stream(_dedup_entries_iter(*entries))]

    for r in results:
        assert 0.0 <= r.score <= 1.0


@pytest.mark.asyncio
async def test_results_are_sorted_descending() -> None:
    """Results are yielded in descending score order."""
    entries = [
        _make_dedup(
            name="A", source_urls=["https://a.com"] * 4, website="https://a.com", email="a@a.com"
        ),
        _make_dedup(name="B", source_urls=[], website=None),
        _make_dedup(name="C", source_urls=["https://c.com"], website="https://c.com"),
    ]

    results = [r async for r in rank_entries_stream(_dedup_entries_iter(*entries))]
    scores = [r.score for r in results]

    assert scores == sorted(scores, reverse=True)
