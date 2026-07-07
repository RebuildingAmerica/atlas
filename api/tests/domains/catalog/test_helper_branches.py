"""Tests for catalog helper branches."""
# ruff: noqa

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, Response

from atlas.domains.catalog.api import org_resources
from atlas.domains.catalog.models import entry_search, ownership, profile_claims
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.catalog.services.directory_domains import (
    DirectoryDomainNotConfiguredError,
    DirectoryDomainVerificationService,
)
from atlas.models import EntryCRUD, SourceCRUD


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


@pytest.mark.parametrize(
    "decoded",
    [
        {"unexpected": True},
        ["good", 1],
    ],
)
def test_decode_string_list_rejects_malformed_json(
    monkeypatch: pytest.MonkeyPatch,
    decoded: object,
) -> None:
    """Ownership helpers should fail closed on malformed JSON arrays."""
    monkeypatch.setattr(ownership.db, "decode_json", lambda _value: decoded)

    with pytest.raises(ValueError, match="must contain a JSON array of strings"):
        ownership._decode_string_list("[]", "issue_areas")


def test_default_verified_proof_summary_falls_back_without_domain() -> None:
    """Proof summaries should stay plain when the email domain is missing."""
    assert (
        profile_claims._default_verified_proof_summary(
            "email_domain",
            {"user_email_domain": ""},
        )
        == "Verified by reviewer decision."
    )


@pytest.mark.parametrize(
    ("entry", "expected"),
    [
        (SimpleNamespace(address=SimpleNamespace(city="Gary", state=None, region=None)), "Gary"),
        (SimpleNamespace(address=SimpleNamespace(city=None, state="IN", region=None)), "IN"),
        (
            SimpleNamespace(address=SimpleNamespace(city=None, state=None, region="Midwest")),
            "Midwest",
        ),
    ],
)
def test_geography_label_falls_back_to_city_state_or_region(
    entry: object,
    expected: str,
) -> None:
    """Geography labels should degrade gracefully when pieces are missing."""
    assert org_resources._geography_label(entry) == expected


def test_effective_public_directory_scope_preserves_configured_values_when_present() -> None:
    """Configured directory metadata should override only the fields it sets."""
    entry = SimpleNamespace(
        issue_area_ids=["housing_affordability"],
        type="organization",
        source_count=1,
        address=SimpleNamespace(city="Gary", state="IN", region="Midwest"),
        freshness=SimpleNamespace(latest_source_date="2026-01-03T00:00:00Z"),
        sources=[],
        claim_evidence=SimpleNamespace(summary=SimpleNamespace(source_count=1)),
    )
    config = SimpleNamespace(
        issue_area_ids=[],
        geography_labels=["Detroit, MI"],
        entry_types=[],
        title=None,
        sponsor_label=None,
        methodology_summary=None,
        source_policy=None,
        review_policy=None,
        correction_policy=None,
        correction_path_template=None,
        missing_context_path_template=None,
    )

    scope = org_resources._effective_public_directory_scope([entry], config)

    assert scope.issue_area_ids == ["housing_affordability"]
    assert scope.geography_labels == ["Detroit, MI"]
    assert scope.entry_types == ["organization"]


def test_directory_config_response_returns_defaults_when_missing() -> None:
    """An absent config should still yield a stable response shell."""
    response = org_resources._directory_config_response("local", None)
    assert response.org_id == "local"


def test_directory_config_methodology_uses_defaults_for_blank_fields() -> None:
    """Blank methodology fields should fall back to the public defaults."""
    config = SimpleNamespace(
        methodology_summary="",
        source_policy="",
        review_policy="",
        correction_policy="",
        correction_path_template="",
        missing_context_path_template="",
    )

    methodology = org_resources._directory_config_methodology(config)

    assert methodology.summary
    assert methodology.source_policy


def test_get_directory_domain_verifier_returns_service() -> None:
    """The verifier factory should return the directory-domain service wrapper."""
    verifier = org_resources.get_directory_domain_verifier()
    assert isinstance(verifier, DirectoryDomainVerificationService)


@pytest.mark.parametrize(
    "value",
    [
        "127.0.0.1",
        "a" * 250 + ".com",
    ],
)
def test_normalize_directory_domain_rejects_ip_and_overlong_domains(value: str) -> None:
    """Directory domains should reject raw IPs and oversize hostnames."""
    with pytest.raises(ValueError, match="Enter a bare domain name"):
        org_resources._normalize_directory_domain(value)


def test_normalize_directory_domain_rejects_missing_dot() -> None:
    """Bare hostnames without a public suffix should be rejected."""
    with pytest.raises(ValueError, match="Enter a bare domain name"):
        org_resources._normalize_directory_domain("localhost")


@pytest.mark.asyncio
async def test_entry_to_source_linked_detail_response_returns_none_when_entry_missing(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Deleted entries should quietly drop out of public directory renders."""

    async def fake_get_with_sources(
        _db: object, _entry_id: str
    ) -> tuple[object | None, list[object]]:
        return None, []

    monkeypatch.setattr(EntryCRUD, "get_with_sources", fake_get_with_sources)
    result = await org_resources._entry_to_source_linked_detail_response(test_db, "missing")
    assert result is None


@pytest.mark.asyncio
async def test_source_link_tolerates_missing_source_refetch(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Source links should still persist if a follow-up source refetch is unavailable."""
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Refetch Missing Source Org",
        description="Used to cover source link refetch behavior.",
        city="Gary",
        state="IN",
        geo_specificity="local",
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.org/refetch-missing",
        source_type="news_article",
        extraction_method="manual",
        title="Refetch missing source",
    )

    async def missing_source(_conn: object, _source_id: str) -> object:
        return None

    monkeypatch.setattr(SourceCRUD, "get_by_id", missing_source)

    await SourceCRUD.link_to_entry(test_db, entry_id, source_id, "Source refetch missing.")

    cursor = await test_db.execute(
        "SELECT extraction_context FROM entry_sources WHERE entry_id = ? AND source_id = ?",
        (entry_id, source_id),
    )
    row = await cursor.fetchone()
    assert row[0] == "Source refetch missing."


@pytest.mark.asyncio
async def test_get_public_directory_skips_missing_entries(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Public directory listing should ignore ownership rows that no longer resolve."""
    monkeypatch.setattr(
        OwnershipCRUD,
        "list_by_org",
        AsyncMock(return_value=[SimpleNamespace(resource_id="missing-entry")]),
    )
    monkeypatch.setattr(
        org_resources,
        "_entry_to_source_linked_detail_response",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(OwnershipCRUD, "get_directory_config", AsyncMock(return_value=None))
    monkeypatch.setattr(
        OwnershipCRUD, "get_verified_directory_domain", AsyncMock(return_value=None)
    )

    response = Response()
    directory = await org_resources.get_public_directory(
        org_id="local", response=response, db=test_db
    )

    assert directory.entries == []
    assert directory.title == "local civic directory"


@pytest.mark.asyncio
async def test_publish_org_entry_rejects_missing_ownership(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Publishing an entry should 404 if the workspace no longer owns it."""
    monkeypatch.setattr(OwnershipCRUD, "get_ownership", AsyncMock(return_value=None))

    with pytest.raises(HTTPException) as exc_info:
        await org_resources.publish_org_entry(
            org_id="local",
            entry_id="missing",
            response=Response(),
            actor=SimpleNamespace(org_id="local"),
            db=test_db,
        )

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_verify_directory_domain_reports_missing_and_failed_verification() -> None:
    """Directory domain verification should stay precise about failure modes."""
    verifier = AsyncMock(spec=DirectoryDomainVerificationService)
    verifier.verify.side_effect = DirectoryDomainNotConfiguredError("missing")
    response = Response()

    with pytest.raises(HTTPException) as exc_info:
        await org_resources.verify_directory_domain(
            org_id="local",
            response=response,
            actor=SimpleNamespace(org_id="local"),
            db=SimpleNamespace(),
            domain_verifier=verifier,
        )
    assert exc_info.value.status_code == 404

    verifier.verify.side_effect = None
    verifier.verify.return_value = None
    with pytest.raises(HTTPException) as exc_info:
        await org_resources.verify_directory_domain(
            org_id="local",
            response=response,
            actor=SimpleNamespace(org_id="local"),
            db=SimpleNamespace(),
            domain_verifier=verifier,
        )
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_get_public_directory_uses_generated_title_when_config_is_missing(
    test_db: object,
) -> None:
    """An empty public directory should still render a stable title and shape."""
    response = Response()
    directory = await org_resources.get_public_directory(
        org_id="local",
        response=response,
        db=test_db,
    )

    assert directory.title == "local civic directory"
    assert directory.entries == []
