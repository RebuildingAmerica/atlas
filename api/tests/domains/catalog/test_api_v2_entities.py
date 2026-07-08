"""Tests for entity and place read surfaces."""

from datetime import date
from http import HTTPStatus

import pytest

from atlas.models import EntryCRUD, SourceCRUD

STATUS_OK = HTTPStatus.OK


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
