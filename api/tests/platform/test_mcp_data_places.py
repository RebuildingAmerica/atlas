"""Place-focused coverage for `atlas.platform.mcp.data`."""
# ruff: noqa

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime

import pytest

from atlas.platform.mcp import data as data_module
from atlas.platform.mcp.data import AtlasDataService

from tests.platform.mcp_data_support import _build_entry


@pytest.mark.asyncio
async def test_get_place_query_scope_uses_context_rows(
    db_url: str,
    test_db: object,
) -> None:
    """Stored place contexts should return an empty filter list when no query filters exist."""
    conn = test_db
    await conn.execute(
        """
        INSERT INTO place_contexts (
            place_key, name, display, kind, source_dataset, source_identifier, source_url,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "gary-in",
            "Gary",
            "Gary, IN",
            "polity",
            "seed",
            "gary",
            "https://example.test",
            datetime.now(UTC).isoformat(),
            datetime.now(UTC).isoformat(),
        ),
    )
    await conn.commit()

    service = AtlasDataService(db_url)
    normalized_place, place_filters = await service._resolve_place_query_scope("Gary, IN")

    assert normalized_place["display"] == "Gary, IN"
    assert place_filters == []


@pytest.mark.asyncio
async def test_get_place_profile_honors_polity_kind_lookup(
    populated_service: AtlasDataService,
) -> None:
    """Polity-scoped lookups should resolve the kind-specific profile key."""
    payload = await populated_service.get_place_profile("Gary, IN", kind="polity")

    assert payload["place"]["display"] == "Gary, IN"


@pytest.mark.asyncio
async def test_get_place_page_context_rejects_missing_place(
    populated_service: AtlasDataService,
) -> None:
    """A missing place page context should fail plainly."""
    with pytest.raises(ValueError, match="Place page context not found"):
        await populated_service.get_place_page_context("Nowhere, ZZ")


def test_contact_source_ids_returns_matching_source_id() -> None:
    """Matching source receipts should be surfaced for contact claims."""
    entry = replace(_build_entry(), website="https://primary.example", email="info@primary.example")
    source_ids = data_module._contact_source_ids(  # noqa: SLF001
        entry,
        [
            {
                "id": "source-1",
                "url": "https://primary.example/story",
                "extraction_context": "primary.example mentions contact details",
            },
            {
                "id": None,
                "url": "https://primary.example/about",
                "extraction_context": "info@primary.example listed here",
            },
        ],
    )
    assert source_ids == ["source-1"]


@pytest.mark.asyncio
async def test_get_place_page_context_returns_database_backed_context(
    db_url: str,
    test_db: object,
) -> None:
    """Stored place-page context should include scopes, facts, governments, and links."""
    conn = test_db
    place_key = "city:gary-in"
    now = datetime.now(UTC).isoformat()
    await conn.execute(
        """
        INSERT INTO place_contexts (
            place_key, name, display, kind, source_dataset, source_identifier, source_url,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            place_key,
            "Gary",
            "Gary, IN",
            "city",
            "seed",
            "gary-city",
            "https://example.test/gary",
            now,
            now,
        ),
    )
    await conn.execute(
        "INSERT INTO place_scope_links (place_key, label, href, active, sort_order) VALUES (?, ?, ?, ?, ?)",
        (place_key, "Gary", "/places/cities/gary-in", 1, 10),
    )
    await conn.execute(
        "INSERT INTO place_summary_facts (place_key, label, value, attribution, sort_order) VALUES (?, ?, ?, ?, ?)",
        (place_key, "Population", "75,000", "Seed source", 10),
    )
    await conn.execute(
        "INSERT INTO place_governments (id, place_key, name, role, sort_order) VALUES (?, ?, ?, ?, ?)",
        (
            "gary-city-government",
            place_key,
            "Gary City Government",
            "City council and city services.",
            10,
        ),
    )
    await conn.execute(
        "INSERT INTO place_government_links (government_id, label, href, sort_order) VALUES (?, ?, ?, ?)",
        ("gary-city-government", "Council", "https://example.test/council", 10),
    )
    await conn.execute(
        """
        INSERT INTO place_related_places (
            id, place_key, name, href, kind, source_dataset, source_identifier, source_url,
            latitude, longitude, summary, accent, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "gary-hammond",
            place_key,
            "Hammond",
            "/places/cities/hammond-in",
            "city",
            "seed",
            "gary-related",
            "https://example.test/related",
            41.582,
            -87.5,
            "Nearby city context.",
            "neutral",
            10,
        ),
    )
    await conn.commit()

    service = AtlasDataService(db_url)
    context = await service.get_place_page_context("Gary, IN", kind="city")

    assert context["place_key"] == place_key
    assert context["kind"] == "city"
    assert context["scopes"] == [
        {"label": "Gary", "href": "/places/cities/gary-in", "active": True}
    ]
    assert context["summary_facts"] == [
        {"label": "Population", "value": "75,000", "attribution": "Seed source"}
    ]
    assert context["governments"][0]["links"] == [
        {"label": "Council", "href": "https://example.test/council"}
    ]
    assert context["places"][0]["name"] == "Hammond"


@pytest.mark.asyncio
async def test_get_place_coverage_summary(
    populated_service: AtlasDataService,
) -> None:
    payload = await populated_service.get_place_coverage("Gary, IN")
    assert payload["entity_count"] >= 1
    assert "housing_affordability" in payload["covered_issue_area_ids"]
    assert "worker_cooperatives" in payload["thin_issue_area_ids"]
    assert payload["uncovered_domains"]


@pytest.mark.asyncio
async def test_get_place_coverage_with_explicit_issue_filter(
    populated_service: AtlasDataService,
) -> None:
    """Issue filter narrows the universe of issues considered."""
    payload = await populated_service.get_place_coverage(
        "Gary, IN", issue_areas=["housing_affordability"]
    )
    expected = ["housing_affordability"]
    issues = [count["issue_area_id"] for count in payload["issue_counts"]]
    assert issues == expected


@pytest.mark.asyncio
async def test_get_place_issue_signals_summarizes_entities(
    populated_service: AtlasDataService,
) -> None:
    payload = await populated_service.get_place_issue_signals("Gary, IN")
    assert payload["place"]["display"] == "Gary, IN"
    assert payload["issues"]
    assert payload["resource_uri"].startswith("atlas://cities/")


@pytest.mark.asyncio
async def test_get_place_issue_signals_filters_to_requested_issues(
    populated_service: AtlasDataService,
) -> None:
    """Issue filter should drop signals outside the requested set."""
    payload = await populated_service.get_place_issue_signals(
        "Gary, IN", issue_areas=["housing_affordability"]
    )
    slugs = [issue["issue_area_id"] for issue in payload["issues"]]
    assert slugs == ["housing_affordability"]


@pytest.mark.asyncio
async def test_get_place_issue_signals_scans_beyond_first_page(
    populated_service: AtlasDataService,
) -> None:
    """A place with more matches than one internal page must still be complete."""
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(data_module, "_EXHAUSTIVE_SCAN_PAGE_SIZE", 1)
        payload = await populated_service.get_place_issue_signals("Gary, IN")

    housing = next(
        issue for issue in payload["issues"] if issue["issue_area_id"] == "housing_affordability"
    )
    assert housing["entity_count"] == 2


@pytest.mark.asyncio
async def test_get_place_coverage_scans_beyond_first_page(
    populated_service: AtlasDataService,
) -> None:
    """Same exhaustive-scan guarantee, for the coverage summary."""
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(data_module, "_EXHAUSTIVE_SCAN_PAGE_SIZE", 1)
        payload = await populated_service.get_place_coverage("Gary, IN")

    assert payload["entity_count"] == 2


@pytest.mark.asyncio
async def test_get_place_profile_returns_seed_data(
    populated_service: AtlasDataService,
) -> None:
    payload = await populated_service.get_place_profile("Gary, IN")
    assert payload["resource_uri"].startswith("atlas://cities/gary-in")
    assert payload["demographics"]["population"] > 0


@pytest.mark.asyncio
async def test_get_place_profile_not_found_raises(
    populated_service: AtlasDataService,
) -> None:
    with pytest.raises(ValueError, match="Place profile not found"):
        await populated_service.get_place_profile("Nowhere, ZZ")
