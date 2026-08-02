"""Tests for catalog helper branches."""
# ruff: noqa

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from atlas.domains.catalog.api import org_resources
from atlas.domains.catalog.models import entry_search


@pytest.mark.parametrize(
    ("sort", "expected"),
    [
        (
            "name",
            "\n            LOWER(e.name) ASC,\n            source_count DESC,\n            latest_source_date DESC,\n            e.verified DESC\n        ",
        ),
        (
            "recent",
            "\n            latest_source_date DESC,\n            source_count DESC,\n            e.verified DESC,\n            LOWER(e.name) ASC\n        ",
        ),
    ],
)
def test_entry_search_order_clause_covers_known_sorts(sort: str, expected: str) -> None:
    """Public search sort order should stay explicit for scanners."""
    assert entry_search._entry_search_order_clause(sort).strip() == expected.strip()


def test_entry_search_order_clause_rejects_unknown_sort() -> None:
    """Unknown search sort values should fail loudly."""
    with pytest.raises(ValueError, match="Invalid entity sort: broken"):
        entry_search._entry_search_order_clause("broken")


@pytest.mark.parametrize(
    ("row", "expected"),
    [
        ({"city": "Gary", "state": "IN"}, "Gary, IN"),
        ({"city": "Gary"}, "Gary"),
        ({"region": "Midwest", "state": "IN"}, "Midwest, IN"),
        ({"region": "Midwest"}, "Midwest"),
        ({"state": "IN"}, "IN"),
        ({}, None),
    ],
)
def test_place_label_covers_city_state_region_variants(
    row: dict[str, object],
    expected: str | None,
) -> None:
    """Map labels should stay short and honest."""
    assert entry_search._place_label(row) == expected


def test_latest_source_date_prefers_public_visible_dates() -> None:
    """Newest source dates should win across source receipts."""
    sources = [
        {"published_date": "2026-01-02T00:00:00Z"},
        {"ingested_at": "2026-01-03T00:00:00Z"},
        {"created_at": "2026-01-01T00:00:00Z"},
    ]
    assert entry_search._latest_source_date(sources) == "2026-01-03"
    assert entry_search._latest_source_date([]) is None


def test_latest_source_date_accepts_postgres_source_timestamps() -> None:
    """Public map freshness should retain PostgreSQL-native source timestamps."""
    sources = [{"ingested_at": datetime(2026, 8, 1, 18, 30, tzinfo=UTC)}]

    assert entry_search._latest_source_date(sources) == "2026-08-01"


@pytest.mark.parametrize("value", [None, "", 123])
def test_date_prefix_rejects_non_string_values(value: object) -> None:
    """Date-prefix extraction should fail closed on non-string values."""
    assert entry_search._date_prefix(value) is None


def test_suppressed_source_ids_and_public_map_sources_filter_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Suppressed public sources should disappear from the map payload."""
    monkeypatch.setattr(
        "atlas.domains.catalog.models.entry_search.db.decode_json",
        lambda _value: ["source-2", 2],
    )
    row = {"suppressed_source_ids": "[1, 2]"}
    sources = [{"id": "source-1"}, {"id": "source-2"}, {"id": "source-3"}]
    assert entry_search._suppressed_source_ids(row) == {"source-2", "2"}
    assert entry_search._public_map_sources(row, sources) == [
        {"id": "source-1"},
        {"id": "source-3"},
    ]

    monkeypatch.setattr(
        "atlas.domains.catalog.models.entry_search.db.decode_json",
        lambda _value: {"unexpected": True},
    )
    assert entry_search._suppressed_source_ids(row) == set()
    assert entry_search._suppressed_source_ids({}) == set()
    assert entry_search._public_map_sources({}, sources) == sources


def test_empty_facets_returns_all_expected_keys() -> None:
    """Empty search facets should keep the public payload shape stable."""
    facets = entry_search._empty_facets()
    assert set(facets) == {
        "states",
        "cities",
        "regions",
        "issue_areas",
        "entity_types",
        "source_types",
        "source_patterns",
    }


@pytest.mark.parametrize(
    ("states", "cities", "regions", "place_filters", "expected"),
    [
        (["IN"], None, None, None, " AND e.state IN (?)"),
        (None, ["Gary"], None, None, " AND e.city IN (?)"),
        (None, None, ["Midwest"], None, " AND e.region IN (?)"),
        (
            None,
            None,
            None,
            [{"state": "IN", "city": "Gary"}],
            " AND ((e.state = ? AND e.city = ?))",
        ),
        (None, None, None, [{"region": "Midwest"}], " AND ((e.region = ?))"),
        (None, None, None, [{"state": None, "city": None, "region": None}], None),
        (None, None, None, [], None),
    ],
)
def test_entry_place_clause_handles_all_filter_modes(
    states: list[str] | None,
    cities: list[str] | None,
    regions: list[str] | None,
    place_filters: list[dict[str, str | None]] | None,
    expected: str | None,
) -> None:
    """Search geography filters should stay deterministic."""
    params: list[object] = []
    clause = entry_search._entry_place_clause(
        states=states,
        cities=cities,
        regions=regions,
        place_filters=place_filters,
        params=params,
    )
    assert clause == expected


@pytest.mark.parametrize(
    ("source_patterns", "expected"),
    [
        (["single_source"], "(COUNT(DISTINCT es_patterns.source_id) = 1)"),
        (["multi_source"], "(COUNT(DISTINCT es_patterns.source_id) >= 2)"),
        (
            ["social_only"],
            (
                "(\n                COUNT(DISTINCT es_patterns.source_id) > 0\n                "
                "AND SUM(CASE WHEN s_patterns.type <> 'social_media' THEN 1 ELSE 0 END) = 0\n            )"
            ),
        ),
        ([], "0 = 1"),
    ],
)
def test_source_pattern_having_clause_covers_controlled_vocab(
    source_patterns: list[str],
    expected: str,
) -> None:
    """Source pattern filters should map to the intended HAVING clauses."""
    clause = entry_search._source_pattern_having_clause(source_patterns).strip()
    if source_patterns == ["social_only"]:
        assert "COUNT(DISTINCT es_patterns.source_id) > 0" in clause
        assert "social_media" in clause
        return
    assert clause == expected.strip()


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("foo_bar-baz", "Foo Bar Baz"),
        ("already title", "Already Title"),
    ],
)
def test_humanize_identifier_cleans_slug_like_identifiers(
    value: str,
    expected: str,
) -> None:
    """Public directory labels should remain readable for humans."""
    assert org_resources._humanize_identifier(value) == expected


@pytest.mark.parametrize(
    ("scope", "expected"),
    [
        (
            SimpleNamespace(geography_labels=["Gary, IN"], issue_area_ids=[], entry_types=[]),
            "Gary, IN civic directory",
        ),
        (
            SimpleNamespace(
                geography_labels=[], issue_area_ids=["housing_affordability"], entry_types=[]
            ),
            "Housing Affordability civic directory",
        ),
        (
            SimpleNamespace(geography_labels=[], issue_area_ids=[], entry_types=[]),
            "local civic directory",
        ),
    ],
)
def test_public_directory_title_prefers_scope_then_org_id(scope: object, expected: str) -> None:
    """Directory titles should pick the most specific honest label available."""
    assert org_resources._public_directory_title("local", scope) == expected


def test_public_directory_scope_and_stats_use_visible_source_dates() -> None:
    """Derived directory summaries should use the oldest visible public shape."""
    entry = SimpleNamespace(
        issue_area_ids=["housing_affordability"],
        type="organization",
        source_count=2,
        address=SimpleNamespace(city="Gary", state="IN", region="Midwest"),
        freshness=SimpleNamespace(latest_source_date="2026-01-03T00:00:00Z"),
        sources=[
            SimpleNamespace(
                freshness=SimpleNamespace(
                    published_date=None,
                    ingested_at="2026-01-01T00:00:00Z",
                    created_at=None,
                )
            ),
            SimpleNamespace(
                freshness=SimpleNamespace(
                    published_date="2026-01-02T00:00:00Z",
                    ingested_at=None,
                    created_at=None,
                )
            ),
        ],
        claim_evidence=SimpleNamespace(summary=SimpleNamespace(source_count=2)),
    )
    scope = org_resources._public_directory_scope([entry])
    stats = org_resources._public_directory_stats([entry])

    assert scope.issue_area_ids == ["housing_affordability"]
    assert scope.geography_labels == ["Gary, IN"]
    assert stats.record_count == 1
    assert stats.source_count == 2
    assert stats.last_reviewed_at == "2026-01-03"
