"""Tests for collection envelopes and mutable public write surfaces."""

from datetime import date
from http import HTTPStatus

import pytest

from atlas.models import EntryCRUD, SourceCRUD

STATUS_OK = HTTPStatus.OK
STATUS_CREATED = HTTPStatus.CREATED
STATUS_ACCEPTED = HTTPStatus.ACCEPTED


@pytest.mark.asyncio
async def test_source_responses_share_canonical_freshness_and_flag_shapes(
    test_client: object,
    test_db: object,
) -> None:
    """Source read surfaces should expose the same normalized source shape."""
    entity_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Gary Housing Justice",
        description="Housing advocacy group in Gary.",
        city="Gary",
        state="IN",
        geo_specificity="local",
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/gary-housing",
        source_type="report",
        extraction_method="manual",
        title="Gary housing conditions report",
        publication="City Lab",
        published_date=date(2024, 1, 20),
    )
    await SourceCRUD.link_to_entry(
        test_db, entity_id, source_id, "Report documents unsafe housing conditions."
    )
    await test_db.execute(
        """
        INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
        VALUES (?, ?, datetime('now'))
        """,
        (entity_id, "housing_affordability"),
    )
    await test_db.commit()

    entity_sources_response = await test_client.get(f"/api/entities/{entity_id}/sources")
    place_sources_response = await test_client.get("/api/places/gary-in/sources")

    assert entity_sources_response.status_code == STATUS_OK
    assert place_sources_response.status_code == STATUS_OK

    entity_source = entity_sources_response.json()["sources"][0]
    place_source = place_sources_response.json()["items"][0]

    for payload in [entity_source, place_source]:
        assert payload["id"] == source_id
        assert payload["linked_entity_ids"] == [entity_id]
        assert len(payload["linked_entities"]) == 1
        linked_entity = payload["linked_entities"][0]
        assert linked_entity["id"] == entity_id
        assert linked_entity["name"] == "Gary Housing Justice"
        assert linked_entity["type"] == "organization"
        assert linked_entity["slug"].startswith("gary-housing-justice-")
        assert linked_entity["issue_area_ids"] == ["housing_affordability"]
        assert "freshness" in payload
        assert payload["freshness"]["staleness_status"] in {"fresh", "aging", "stale", "unknown"}
        assert "flag_summary" in payload
        assert payload["flag_summary"]["flag_count"] == 0
        assert "resource_uri" in payload


@pytest.mark.asyncio
async def test_collection_endpoints_use_consistent_envelopes(
    test_client: object,
) -> None:
    """Collections should use a common envelope instead of mixing arrays and offset pagination."""
    discovery_response = await test_client.post(
        "/api/discovery-runs",
        json={
            "location_query": "Gary, IN",
            "state": "IN",
            "issue_areas": ["housing_affordability"],
        },
    )
    assert discovery_response.status_code == STATUS_ACCEPTED

    entities_response = await test_client.get("/api/entities")
    discovery_list_response = await test_client.get("/api/discovery-runs")

    assert entities_response.status_code == STATUS_OK
    assert discovery_list_response.status_code == STATUS_OK

    for payload in [entities_response.json(), discovery_list_response.json()]:
        assert "items" in payload
        assert "total" in payload
        assert "next_cursor" in payload
        assert "pagination" not in payload


@pytest.mark.asyncio
async def test_entity_writes_accept_canonical_address_and_contact_shapes(
    test_client: object,
) -> None:
    """Entity writes should accept the same nested address/contact model used in reads."""
    create_response = await test_client.post(
        "/api/entities",
        json={
            "type": "organization",
            "name": "Nested Shape Org",
            "description": "Organization created with canonical nested write fields.",
            "address": {
                "city": "Oakland",
                "state": "CA",
                "region": "East Bay",
                "full_address": "123 Lakeshore Ave, Oakland, CA 94610",
                "geo_specificity": "local",
            },
            "contact": {
                "website": "https://nested.example.org",
                "email": "info@nested.example.org",
                "phone": "555-1212",
                "social_media": {"instagram": "@nestedorg"},
            },
            "issue_area_ids": ["housing_affordability"],
        },
    )

    assert create_response.status_code == STATUS_CREATED
    payload = create_response.json()
    assert payload["address"]["city"] == "Oakland"
    assert payload["contact"]["website"] == "https://nested.example.org"
    assert payload["issue_area_ids"] == ["housing_affordability"]

    entity_id = payload["id"]
    update_response = await test_client.patch(
        f"/api/entities/{entity_id}",
        json={
            "address": {"city": "Berkeley", "state": "CA", "geo_specificity": "local"},
            "contact": {"email": "updated@nested.example.org"},
        },
    )

    assert update_response.status_code == STATUS_OK
    updated = update_response.json()
    assert updated["address"]["city"] == "Berkeley"
    assert updated["contact"]["email"] == "updated@nested.example.org"


@pytest.mark.asyncio
async def test_all_listable_resources_support_limit_and_cursor(
    test_client: object,
    test_db: object,
) -> None:
    """Every list endpoint should support cursor pagination consistently."""
    entity_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Paged Flags Org",
        description="Entity used to verify list pagination.",
        city="Gary",
        state="IN",
        geo_specificity="local",
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/paged-source",
        source_type="report",
        extraction_method="manual",
        title="Paged source",
        publication="Metro Desk",
        published_date=date(2024, 5, 5),
    )
    await SourceCRUD.link_to_entry(test_db, entity_id, source_id, "Used for pagination coverage.")

    await test_client.post(
        "/api/entity-flags", json={"entity_id": entity_id, "reason": "stale_information"}
    )
    await test_client.post(
        "/api/source-flags", json={"source_id": source_id, "reason": "outdated_source"}
    )
    await test_client.post(
        "/api/discovery-runs",
        json={
            "location_query": "Gary, IN",
            "state": "IN",
            "issue_areas": ["housing_affordability"],
        },
    )

    responses = [
        await test_client.get("/api/discovery-runs?limit=1&cursor=0"),
        await test_client.get(f"/api/entity-flags?entity_id={entity_id}&limit=1&cursor=0"),
        await test_client.get(f"/api/source-flags?source_id={source_id}&limit=1&cursor=0"),
        await test_client.get("/api/domains?limit=5&cursor=0"),
        await test_client.get("/api/issue-areas?limit=5&cursor=0"),
    ]

    for response in responses:
        assert response.status_code == STATUS_OK
        payload = response.json()
        assert "items" in payload
        assert "total" in payload
        assert "next_cursor" in payload


@pytest.mark.asyncio
async def test_issue_area_query_reuses_canonical_issue_area_shape(test_client: object) -> None:
    """Querying issue areas should not switch to a different item schema."""
    response = await test_client.get("/api/issue-areas?query=housing")

    assert response.status_code == STATUS_OK
    payload = response.json()
    assert payload["items"]
    first = payload["items"][0]
    assert {"id", "slug", "name", "description", "domain"} <= set(first)
    assert "match_score" in first


@pytest.mark.asyncio
async def test_anonymous_entity_and_source_flags_are_persisted_and_summarized(
    test_client: object,
    test_db: object,
) -> None:
    """Users should be able to anonymously flag stale entity/source data."""
    entity_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Flaggable Org",
        description="Entity for flagging tests.",
        city="Gary",
        state="IN",
        geo_specificity="local",
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/flaggable-source",
        source_type="news_article",
        extraction_method="manual",
        title="Flaggable source",
        publication="Gary Post",
        published_date=date(2023, 5, 1),
    )
    await SourceCRUD.link_to_entry(test_db, entity_id, source_id, "This source may be outdated.")

    entity_flag_response = await test_client.post(
        "/api/entity-flags",
        json={
            "entity_id": entity_id,
            "reason": "stale_information",
            "note": "Phone number bounced.",
        },
    )
    source_flag_response = await test_client.post(
        "/api/source-flags",
        json={"source_id": source_id, "reason": "outdated_source"},
    )

    assert entity_flag_response.status_code == STATUS_CREATED
    assert source_flag_response.status_code == STATUS_CREATED
    assert entity_flag_response.json()["status"] == "open"
    assert source_flag_response.json()["status"] == "open"

    entity_flags_list = await test_client.get(f"/api/entity-flags?entity_id={entity_id}")
    source_flags_list = await test_client.get(f"/api/source-flags?source_id={source_id}")
    entity_detail = await test_client.get(f"/api/entities/{entity_id}")
    entity_sources = await test_client.get(f"/api/entities/{entity_id}/sources")

    assert entity_flags_list.status_code == STATUS_OK
    assert source_flags_list.status_code == STATUS_OK
    assert entity_flags_list.json()["items"][0]["reason"] == "stale_information"
    assert source_flags_list.json()["items"][0]["reason"] == "outdated_source"
    assert entity_detail.json()["flag_summary"]["open_flag_count"] == 1
    assert entity_sources.json()["sources"][0]["flag_summary"]["open_flag_count"] == 1
