"""Public-search coverage for atlas.domains.catalog.models.entry."""

from __future__ import annotations

from datetime import date

import pytest

from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.models import SourceCRUD


@pytest.mark.asyncio
async def test_search_public_id_filter_branches_with_full_query_payload(
    test_db: object,
) -> None:
    """Hit each filter branch in _search_public_ids (lines 956-987)."""
    conn = test_db
    parent_org_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Parent Affiliate Org",
        description="Parent organization referenced via affiliated_org_id.",
        city="Kansas City",
        state="MO",
        geo_specificity="regional",
        region="Kansas City metro",
    )
    entry_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Comprehensive Filter Org",
        description="Entry that matches every public-search facet filter.",
        city="Kansas City",
        state="MO",
        geo_specificity="regional",
        region="Kansas City metro",
        affiliated_org_id=parent_org_id,
    )
    await conn.execute(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) "
        "VALUES (?, ?, datetime('now'))",
        (entry_id, "housing_affordability"),
    )
    await conn.commit()

    source_id = await SourceCRUD.create(
        conn,
        url="https://example.com/coverage-search-public",
        source_type="news_article",
        extraction_method="manual",
        title="Coverage source",
        publication="Test Publication",
        published_date=date(2026, 2, 1),
    )
    await SourceCRUD.link_to_entry(
        conn,
        entry_id,
        source_id,
        extraction_context="Used for facet filter coverage.",
    )

    result = await EntryCRUD.search_public(
        conn,
        query="Comprehensive",
        states=["MO"],
        cities=["Kansas City"],
        regions=["Kansas City metro"],
        issue_areas=["housing_affordability"],
        entry_types=["organization"],
        source_types=["news_article"],
        affiliated_org_id=parent_org_id,
    )

    assert result["total"] >= 1
    assert any(item["entry"].id == entry_id for item in result["entries"])


@pytest.mark.asyncio
async def test_search_public_filters_and_facets_source_patterns(test_db: object) -> None:
    """Search should expose trust-relevant source patterns for filtering."""
    conn = test_db
    single_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Single Source Org",
        description="One source only.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )
    multi_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Multi Source Org",
        description="Two independent source types.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )
    social_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Social Only Org",
        description="Only social evidence.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )

    async def link_source(entry_id: str, slug: str, source_type: str) -> None:
        source_id = await SourceCRUD.create(
            conn,
            url=f"https://example.com/{slug}",
            source_type=source_type,
            extraction_method="manual",
            title=f"{slug} source",
            publication="Test Publication",
            published_date=date(2026, 2, 1),
        )
        await SourceCRUD.link_to_entry(conn, entry_id, source_id)

    await link_source(single_id, "single", "news_article")
    await link_source(multi_id, "multi-news", "news_article")
    await link_source(multi_id, "multi-report", "report")
    await link_source(social_id, "social", "social_media")

    unfiltered = await EntryCRUD.search_public(conn)
    assert {"value": "multi_source", "count": 1} in unfiltered["facets"]["source_patterns"]
    assert {"value": "single_source", "count": 2} in unfiltered["facets"]["source_patterns"]
    assert {"value": "social_only", "count": 1} in unfiltered["facets"]["source_patterns"]

    result = await EntryCRUD.search_public(conn, source_patterns=["multi_source"])

    result_ids = {item["entry"].id for item in result["entries"]}
    assert multi_id in result_ids
    assert single_id not in result_ids
    assert social_id not in result_ids
    assert {"value": "multi_source", "count": 1} in result["facets"]["source_patterns"]


@pytest.mark.asyncio
async def test_load_entries_with_metrics_returns_empty_for_empty_ids(test_db: object) -> None:
    """_load_entries_with_metrics should short-circuit on empty input (line 1001)."""
    rows = await EntryCRUD._load_entries_with_metrics(  # noqa: SLF001
        test_db, [], limit=10, offset=0, sort="relevance"
    )
    assert rows == []


@pytest.mark.asyncio
async def test_load_entries_with_metrics_returns_empty_when_offset_overshoots(
    test_db: object, sample_entry: object
) -> None:
    """_load_entries_with_metrics should return [] when no rows match the page (line 1022)."""
    rows = await EntryCRUD._load_entries_with_metrics(  # noqa: SLF001
        test_db, [sample_entry], limit=1, offset=100, sort="relevance"
    )
    assert rows == []


@pytest.mark.asyncio
async def test_search_public_prioritizes_actor_leads_before_artifacts(test_db: object) -> None:
    """Mixed browse results should put contactable actors ahead of high-mention artifacts."""
    conn = test_db
    person_id = await EntryCRUD.create(
        conn,
        entry_type="person",
        name="Tenant Union Organizer",
        description="A tenant union organizer available for local housing interviews.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
        email="organizer@example.org",
    )
    campaign_id = await EntryCRUD.create(
        conn,
        entry_type="campaign",
        name="Tenant Union Campaign",
        description="A campaign with more coverage but no direct public contact.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )
    for entry_id in [person_id, campaign_id]:
        await conn.execute(
            "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) "
            "VALUES (?, ?, datetime('now'))",
            (entry_id, "housing_affordability"),
        )

    person_source_id = await SourceCRUD.create(
        conn,
        url="https://example.org/person-source",
        source_type="news_article",
        extraction_method="manual",
        title="Organizer interview",
        publication="Local Press",
        published_date=date(2026, 2, 1),
    )
    await SourceCRUD.link_to_entry(
        conn,
        person_id,
        person_source_id,
        extraction_context="Names the organizer as a housing contact.",
    )

    for index in range(2):
        source_id = await SourceCRUD.create(
            conn,
            url=f"https://example.org/campaign-source-{index}",
            source_type="news_article",
            extraction_method="manual",
            title=f"Campaign coverage {index}",
            publication="Local Press",
            published_date=date(2026, 3, index + 1),
        )
        await SourceCRUD.link_to_entry(
            conn,
            campaign_id,
            source_id,
            extraction_context="Mentions the campaign.",
        )

    result = await EntryCRUD.search_public(
        conn,
        query="Tenant Union",
        states=["MO"],
        issue_areas=["housing_affordability"],
    )

    assert result["entries"][0]["entry"].id == person_id


@pytest.mark.asyncio
async def test_search_public_prioritizes_specific_actors_over_vague_records(
    test_db: object,
) -> None:
    """Browse should favor records that clearly name who does what in which place."""
    conn = test_db
    specific_id = await EntryCRUD.create(
        conn,
        entry_type="organization",
        name="Eastside Tenant Clinic",
        description="Runs tenant legal clinics for renters facing eviction.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )
    vague_id = await EntryCRUD.create(
        conn,
        entry_type="initiative",
        name="Tenant Clinic Resource Roundup",
        description="",
        city=None,
        state=None,
        geo_specificity="national",
    )
    await conn.execute(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) "
        "VALUES (?, ?, datetime('now'))",
        (specific_id, "housing_affordability"),
    )
    for index, entry_id in enumerate([specific_id, vague_id]):
        source_id = await SourceCRUD.create(
            conn,
            url=f"https://example.org/specificity-{index}",
            source_type="news_article",
            extraction_method="manual",
            title="Tenant clinic coverage",
            published_date=date(2026, 4, index + 1),
        )
        await SourceCRUD.link_to_entry(conn, entry_id, source_id)

    result = await EntryCRUD.search_public(conn, query="Tenant Clinic")

    assert result["entries"][0]["entry"].id == specific_id
    assert result["entries"][0]["actor_quality"]["level"] == "specific_actor"
    assert result["entries"][1]["actor_quality"]["level"] == "thin_record"


@pytest.mark.asyncio
async def test_build_facets_returns_empty_payload_for_empty_ids(test_db: object) -> None:
    """_build_facets should return the empty facet payload on empty input (line 1043)."""
    result = await EntryCRUD._build_facets(test_db, [])  # noqa: SLF001
    assert result == {
        "states": [],
        "cities": [],
        "regions": [],
        "issue_areas": [],
        "entity_types": [],
        "source_types": [],
        "source_patterns": [],
    }
