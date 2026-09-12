"""Tests for shared query-generation primitives."""

from __future__ import annotations

from atlas_discovery_engine.querying import (
    SearchQuery,
    generate_queries,
    generate_queries_stream,
)


def test_generate_queries_emits_for_known_issue_areas() -> None:
    queries = generate_queries(
        "Kansas City",
        "MO",
        ["housing_affordability"],
    )

    assert queries
    assert all(isinstance(q, SearchQuery) for q in queries)
    assert all("Kansas City, MO" in q.query for q in queries)
    assert all(q.issue_area == "housing_affordability" for q in queries)


def test_generate_queries_skips_unknown_issue_areas() -> None:
    queries = generate_queries(
        "Austin",
        "TX",
        ["nonexistent_issue_slug_xyz"],
    )

    assert queries == []


def test_generate_queries_keeps_known_when_some_unknown() -> None:
    queries = generate_queries(
        "Austin",
        "TX",
        ["nonexistent_xyz", "housing_affordability"],
    )

    assert queries
    assert all(q.issue_area == "housing_affordability" for q in queries)


def test_generate_queries_local_outlet_expansion() -> None:
    queries = generate_queries(
        "Phoenix",
        "AZ",
        ["housing_affordability"],
        local_outlets=["azcentral.com", "phoenixnewtimes.com"],
    )

    outlet_queries = [q for q in queries if "azcentral.com" in q.query]
    assert outlet_queries
    other_outlet_queries = [q for q in queries if "phoenixnewtimes.com" in q.query]
    assert other_outlet_queries


def test_generate_queries_without_local_outlets_skips_outlet_token() -> None:
    queries = generate_queries(
        "Phoenix",
        "AZ",
        ["housing_affordability"],
    )

    assert queries
    for query in queries:
        assert "{local_outlet}" not in query.query


def test_generate_queries_custom_source_patterns() -> None:
    custom = {"custom_source": ["{location} {keywords} custom"]}
    queries = generate_queries(
        "Boise",
        "ID",
        ["housing_affordability"],
        source_patterns=custom,
    )

    assert queries
    assert all(q.source_category == "custom_source" for q in queries)
    assert all("custom" in q.query for q in queries)


async def test_generate_queries_stream_iterates_all() -> None:
    sync_queries = generate_queries(
        "Denver",
        "CO",
        ["housing_affordability"],
    )

    streamed: list[SearchQuery] = []
    async for query in generate_queries_stream(
        "Denver",
        "CO",
        ["housing_affordability"],
    ):
        streamed.append(query)

    assert streamed == sync_queries


async def test_generate_queries_stream_passes_kwargs() -> None:
    streamed: list[SearchQuery] = []
    custom = {"only_one": ["{location} {keywords}"]}
    async for query in generate_queries_stream(
        "Reno",
        "NV",
        ["housing_affordability"],
        local_outlets=["rgj.com"],
        source_patterns=custom,
    ):
        streamed.append(query)

    assert streamed
    assert all(q.source_category == "only_one" for q in streamed)
