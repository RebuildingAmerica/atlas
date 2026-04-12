"""Tests for Step 1: query_gen."""

import pytest

from atlas_scout.steps.query_gen import SearchQuery, generate_queries, generate_queries_stream


def test_generates_results_for_valid_issues() -> None:
    """generate_queries returns non-empty list for known issue area slugs."""
    queries = generate_queries("Austin", "TX", ["housing_affordability"])
    assert len(queries) > 0
    assert all(isinstance(q, SearchQuery) for q in queries)


def test_includes_location_in_all_queries() -> None:
    """Every generated query string contains the city and state."""
    queries = generate_queries("Detroit", "MI", ["union_organizing"])
    for q in queries:
        assert "Detroit" in q.query
        assert "MI" in q.query


def test_skips_unknown_issues() -> None:
    """generate_queries returns empty list for unrecognised issue slugs."""
    queries = generate_queries("Dallas", "TX", ["nonexistent_issue_area"])
    assert queries == []


def test_multiple_issues_produce_queries_for_each() -> None:
    """Queries are generated for every valid issue area in the list."""
    issues = ["housing_affordability", "union_organizing"]
    queries = generate_queries("Chicago", "IL", issues)
    issue_areas_seen = {q.issue_area for q in queries}
    assert "housing_affordability" in issue_areas_seen
    assert "union_organizing" in issue_areas_seen


def test_source_categories_are_populated() -> None:
    """Each query has a non-empty source_category from the defined patterns."""
    queries = generate_queries("Portland", "OR", ["energy_transition"])
    categories = {q.source_category for q in queries}
    expected = {"local_journalism", "nonprofits", "individuals", "campaigns", "academic_policy"}
    assert categories == expected


@pytest.mark.asyncio
async def test_async_generator_yields_same_results() -> None:
    """generate_queries_stream yields the same queries as generate_queries."""
    sync_queries = generate_queries("Seattle", "WA", ["housing_affordability"])
    async_queries = [q async for q in generate_queries_stream("Seattle", "WA", ["housing_affordability"])]

    assert len(async_queries) == len(sync_queries)
    assert [(q.query, q.source_category, q.issue_area) for q in async_queries] == [
        (q.query, q.source_category, q.issue_area) for q in sync_queries
    ]
