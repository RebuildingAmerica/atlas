"""Tests for the place-first public API surface."""

from datetime import date
from http import HTTPStatus

import pytest

from atlas.models import EntryCRUD, SourceCRUD

STATUS_OK = HTTPStatus.OK


@pytest.mark.asyncio
async def test_get_place_returns_canonical_identity(test_client: object) -> None:
    """Places should be exposed as first-class resources."""
    response = await test_client.get("/api/places/gary-in")

    assert response.status_code == STATUS_OK
    payload = response.json()
    assert payload["place"]["city"] == "Gary"
    assert payload["place"]["state"] == "IN"


@pytest.mark.asyncio
async def test_get_place_entities_filters_by_issue_and_entity_type(
    test_client: object,
    test_db: object,
) -> None:
    """Agents should be able to ask for orgs working on an issue in a place."""
    org_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Utah Clean Air Network",
        description="Environmental justice organization in Salt Lake City.",
        city="Salt Lake City",
        state="UT",
        geo_specificity="local",
    )
    await test_db.execute(
        """
        INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        """,
        (org_id, "environmental_justice_and_pollution"),
    )
    await test_db.commit()

    response = await test_client.get(
        "/api/places/ut/entities?issue_area=environmental_justice_and_pollution&entity_type=organization"
    )

    assert response.status_code == STATUS_OK
    payload = response.json()
    assert payload["items"][0]["id"] == org_id
    assert payload["items"][0]["type"] == "organization"


@pytest.mark.asyncio
async def test_place_entities_use_database_scope_filters(
    test_client: object,
    test_db: object,
) -> None:
    """Civic place pages should use stored scope filters, while city pages stay exact."""
    las_vegas_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Las Vegas Tenant Union",
        description="Tenant organizing in Las Vegas.",
        city="Las Vegas",
        state="NV",
        geo_specificity="local",
    )
    henderson_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Henderson Housing Coalition",
        description="Housing organizing in Henderson.",
        city="Henderson",
        state="NV",
        geo_specificity="local",
    )
    reno_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Reno Housing Coalition",
        description="Housing organizing in Reno.",
        city="Reno",
        state="NV",
        geo_specificity="local",
    )

    polity_response = await test_client.get("/api/places/las-vegas-nv/entities")
    city_response = await test_client.get("/api/places/las-vegas-nv/entities?kind=city")

    assert polity_response.status_code == STATUS_OK
    assert city_response.status_code == STATUS_OK
    polity_ids = {item["id"] for item in polity_response.json()["items"]}
    city_ids = {item["id"] for item in city_response.json()["items"]}
    assert {las_vegas_id, henderson_id} <= polity_ids
    assert reno_id not in polity_ids
    assert las_vegas_id in city_ids
    assert henderson_id not in city_ids


@pytest.mark.asyncio
async def test_place_sources_use_database_scope_filters(
    test_client: object,
    test_db: object,
) -> None:
    """Latest activity should use the same real place scope as actor lists."""
    las_vegas_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Las Vegas Transit Riders",
        description="Transit advocacy in Las Vegas.",
        city="Las Vegas",
        state="NV",
        geo_specificity="local",
    )
    henderson_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Henderson Transit Riders",
        description="Transit advocacy in Henderson.",
        city="Henderson",
        state="NV",
        geo_specificity="local",
    )
    las_vegas_source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/las-vegas-transit",
        source_type="government_record",
        extraction_method="manual",
        title="Las Vegas transit agenda",
        publication="City of Las Vegas",
        published_date=date(2026, 2, 1),
    )
    henderson_source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/henderson-transit",
        source_type="government_record",
        extraction_method="manual",
        title="Henderson transit agenda",
        publication="City of Henderson",
        published_date=date(2026, 2, 2),
    )
    await SourceCRUD.link_to_entry(test_db, las_vegas_id, las_vegas_source_id)
    await SourceCRUD.link_to_entry(test_db, henderson_id, henderson_source_id)
    await test_db.commit()

    polity_response = await test_client.get("/api/places/las-vegas-nv/sources")
    city_response = await test_client.get("/api/places/las-vegas-nv/sources?kind=city")

    assert polity_response.status_code == STATUS_OK
    assert city_response.status_code == STATUS_OK
    polity_ids = {item["id"] for item in polity_response.json()["items"]}
    city_ids = {item["id"] for item in city_response.json()["items"]}
    assert {las_vegas_source_id, henderson_source_id} <= polity_ids
    assert las_vegas_source_id in city_ids
    assert henderson_source_id not in city_ids


@pytest.mark.asyncio
async def test_place_issue_signals_use_database_scope_filters(
    test_client: object,
    test_db: object,
) -> None:
    """Issue summaries should match the requested civic or administrative scope."""
    las_vegas_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Las Vegas Housing Group",
        description="Housing advocacy in Las Vegas.",
        city="Las Vegas",
        state="NV",
        geo_specificity="local",
    )
    henderson_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Henderson Transit Group",
        description="Transit advocacy in Henderson.",
        city="Henderson",
        state="NV",
        geo_specificity="local",
    )
    await test_db.execute(
        """
        INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        """,
        (las_vegas_id, "housing_affordability"),
    )
    await test_db.execute(
        """
        INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        """,
        (henderson_id, "public_transit"),
    )
    await test_db.commit()

    polity_response = await test_client.get("/api/places/las-vegas-nv/issue-signals")
    city_response = await test_client.get("/api/places/las-vegas-nv/issue-signals?kind=city")

    assert polity_response.status_code == STATUS_OK
    assert city_response.status_code == STATUS_OK
    polity_issue_ids = {item["issue_area_id"] for item in polity_response.json()["issues"]}
    city_issue_ids = {item["issue_area_id"] for item in city_response.json()["issues"]}
    assert {"housing_affordability", "public_transit"} <= polity_issue_ids
    assert "housing_affordability" in city_issue_ids
    assert "public_transit" not in city_issue_ids


@pytest.mark.asyncio
async def test_get_place_entities_sorts_by_recent_activity(
    test_client: object,
    test_db: object,
) -> None:
    """Place entity sorting should be honored by the public endpoint."""
    older_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Reno Older Coalition",
        description="Older source coverage.",
        city="Reno",
        state="NV",
        geo_specificity="local",
    )
    newer_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Reno Newer Coalition",
        description="Newer source coverage.",
        city="Reno",
        state="NV",
        geo_specificity="local",
    )
    older_source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/reno-older",
        source_type="news_article",
        extraction_method="manual",
        title="Older Reno source",
        publication="Reno Gazette",
        published_date=date(2026, 1, 1),
    )
    newer_source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/reno-newer",
        source_type="news_article",
        extraction_method="manual",
        title="Newer Reno source",
        publication="Reno Gazette",
        published_date=date(2026, 2, 1),
    )
    await SourceCRUD.link_to_entry(test_db, older_id, older_source_id)
    await SourceCRUD.link_to_entry(test_db, newer_id, newer_source_id)
    await test_db.commit()

    response = await test_client.get("/api/places/reno-nv/entities?sort=recent")

    assert response.status_code == STATUS_OK
    payload = response.json()
    assert payload["items"][0]["id"] == newer_id
