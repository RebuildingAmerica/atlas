"""Tests for capping a run's query list without losing source coverage."""

from __future__ import annotations

from atlas_discovery_engine.querying import (
    SearchQuery,
    generate_queries,
    sample_queries_across_categories,
)


def _query(category: str, text: str) -> SearchQuery:
    return SearchQuery(query=text, source_category=category, issue_area="housing_affordability")


def test_sample_spreads_across_every_category_rather_than_taking_the_head() -> None:
    queries = generate_queries("Kansas City", "MO", ["housing_affordability"])
    categories = {q.source_category for q in queries}

    sampled = sample_queries_across_categories(queries, 40)

    assert len(sampled) == 40
    # Head-first truncation would return one category; the point is to reach all.
    assert {q.source_category for q in sampled} == categories


def test_sample_returns_the_whole_list_when_it_already_fits() -> None:
    queries = [_query("nonprofits", "a"), _query("government", "b")]

    assert sample_queries_across_categories(queries, 5) == queries


def test_sample_keeps_nothing_for_a_non_positive_limit() -> None:
    queries = [_query("nonprofits", "a"), _query("government", "b")]

    assert sample_queries_across_categories(queries, 0) == []


def test_sample_deals_one_per_category_before_a_second_from_any() -> None:
    queries = [
        _query("nonprofits", "n1"),
        _query("nonprofits", "n2"),
        _query("nonprofits", "n3"),
        _query("government", "g1"),
    ]

    sampled = sample_queries_across_categories(queries, 3)

    assert [q.query for q in sampled] == ["n1", "g1", "n2"]


def test_sample_drains_a_longer_category_once_the_short_one_runs_out() -> None:
    queries = [
        _query("nonprofits", "n1"),
        _query("nonprofits", "n2"),
        _query("nonprofits", "n3"),
        _query("nonprofits", "n4"),
        _query("government", "g1"),
    ]

    sampled = sample_queries_across_categories(queries, 4)

    assert [q.query for q in sampled] == ["n1", "g1", "n2", "n3"]
