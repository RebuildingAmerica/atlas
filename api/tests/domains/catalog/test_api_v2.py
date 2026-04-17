"""Tests for the place-first public API surface."""

from datetime import date
from http import HTTPStatus

import pytest

from atlas.models import EntryCRUD, SourceCRUD

STATUS_OK = HTTPStatus.OK
STATUS_CREATED = HTTPStatus.CREATED
STATUS_ACCEPTED = HTTPStatus.ACCEPTED


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
        VALUES (?, ?, datetime('now'))
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
async def test_entity_and_place_filters_accept_comma_delimited_query_values(
    test_client: object,
    test_db: object,
) -> None:
    """Generated clients that serialize arrays as comma-delimited strings should still work."""
    mo_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Missouri Housing Network",
        description="Housing organization in Missouri.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )
    ks_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Kansas Worker Center",
        description="Worker center in Kansas.",
        city="Wichita",
        state="KS",
        geo_specificity="local",
    )

    entities_response = await test_client.get("/api/entities?state=MO,KS&entity_type=organization")
    place_response = await test_client.get(
        "/api/places/ks/entities?entity_type=organization,person"
    )

    assert entities_response.status_code == STATUS_OK
    assert {item["id"] for item in entities_response.json()["items"]} >= {mo_id, ks_id}
    assert place_response.status_code == STATUS_OK
    assert all(item["type"] == "organization" for item in place_response.json()["items"])


@pytest.mark.asyncio
async def test_get_place_issue_signals_returns_issue_summary(
    test_client: object,
    test_db: object,
) -> None:
    """Issue signals should summarize what Atlas knows about a town."""
    org_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Central Valley Water Watch",
        description="Community water advocates in Stockton.",
        city="Stockton",
        state="CA",
        geo_specificity="local",
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/water",
        source_type="news_article",
        extraction_method="manual",
        title="Water advocates push for cleanup",
        publication="Valley News",
        published_date=date(2026, 1, 10),
    )
    await test_db.execute(
        """
        INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
        VALUES (?, ?, datetime('now'))
        """,
        (org_id, "water_access_and_infrastructure"),
    )
    await SourceCRUD.link_to_entry(
        test_db, org_id, source_id, "Residents are demanding clean water."
    )

    response = await test_client.get("/api/places/stockton-ca/issue-signals")

    assert response.status_code == STATUS_OK
    payload = response.json()
    issue_ids = {item["issue_area_id"] for item in payload["issues"]}
    assert "water_access_and_infrastructure" in issue_ids


@pytest.mark.asyncio
async def test_get_place_profile_returns_gary_indiana_context(test_client: object) -> None:
    """Place profiles should return city context when Atlas has a dataset row."""
    response = await test_client.get("/api/places/gary-in/profile")

    assert response.status_code == STATUS_OK
    payload = response.json()
    assert payload["place"]["city"] == "Gary"
    assert payload["place"]["state"] == "IN"
    assert payload["demographics"]["population"] > 0
    assert payload["economics"]["median_household_income"] > 0


@pytest.mark.asyncio
async def test_get_entity_and_entity_sources_use_entity_language(
    test_client: object,
    test_db: object,
) -> None:
    """Entity detail endpoints should use entity-first naming."""
    entity_id = await EntryCRUD.create(
        test_db,
        entry_type="initiative",
        name="Gary Health Access Project",
        description="Community health initiative in Gary.",
        city="Gary",
        state="IN",
        geo_specificity="local",
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.com/gary-health",
        source_type="report",
        extraction_method="manual",
        title="Health project expands services",
        publication="Gary Civic Monitor",
        published_date=date(2026, 2, 1),
    )
    await SourceCRUD.link_to_entry(
        test_db, entity_id, source_id, "The initiative expanded clinic hours."
    )

    detail_response = await test_client.get(f"/api/entities/{entity_id}")
    sources_response = await test_client.get(f"/api/entities/{entity_id}/sources")

    assert detail_response.status_code == STATUS_OK
    assert detail_response.json()["id"] == entity_id
    assert sources_response.status_code == STATUS_OK
    assert sources_response.json()["entity_id"] == entity_id


@pytest.mark.asyncio
async def test_entity_responses_share_canonical_address_contact_and_freshness_shapes(
    test_client: object,
    test_db: object,
) -> None:
    """Entity read surfaces should reuse the same nested address/contact/freshness types."""
    entity_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Fresh Fields Collective",
        description="Food sovereignty collective based in Fresno.",
        city="Fresno",
        state="CA",
        region="Central Valley",
        geo_specificity="local",
        full_address="123 Farm Rd, Fresno, CA 93721",
        website="https://freshfields.example.org",
        email="hello@freshfields.example.org",
        phone="555-111-2222",
        social_media={"instagram": "@freshfields"},
    )
    await test_db.execute(
        """
        INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
        VALUES (?, ?, datetime('now'))
        """,
        (entity_id, "food_systems_and_agriculture"),
    )
    await test_db.commit()

    detail_response = await test_client.get(f"/api/entities/{entity_id}")
    list_response = await test_client.get("/api/entities?state=CA")
    place_response = await test_client.get("/api/places/fresno-ca/entities")

    assert detail_response.status_code == STATUS_OK
    detail_payload = detail_response.json()
    list_payload = list_response.json()
    place_payload = place_response.json()

    for payload in [
        detail_payload,
        list_payload["items"][0],
        place_payload["items"][0],
    ]:
        assert "address" in payload
        assert payload["address"]["city"] == "Fresno"
        assert payload["address"]["state"] == "CA"
        assert "contact" in payload
        assert payload["contact"]["website"] == "https://freshfields.example.org"
        assert payload["contact"]["social_media"]["instagram"] == "@freshfields"
        assert "freshness" in payload
        assert payload["freshness"]["staleness_status"] in {"fresh", "aging", "stale", "unknown"}
        assert "flag_summary" in payload
        assert payload["flag_summary"]["flag_count"] == 0
        assert "issue_area_ids" in payload
        assert "city" not in payload
        assert "full_address" not in payload
        assert "website" not in payload
        assert "socials" not in payload
        assert "social_media" not in payload


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

    entity_sources_response = await test_client.get(f"/api/entities/{entity_id}/sources")
    place_sources_response = await test_client.get("/api/places/gary-in/sources")

    assert entity_sources_response.status_code == STATUS_OK
    assert place_sources_response.status_code == STATUS_OK

    entity_source = entity_sources_response.json()["sources"][0]
    place_source = place_sources_response.json()["items"][0]

    for payload in [entity_source, place_source]:
        assert payload["id"] == source_id
        assert payload["linked_entity_ids"] == [entity_id]
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
