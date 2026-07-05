"""Database-backed place page context API tests."""

from __future__ import annotations

import pytest

HTTP_OK = 200


@pytest.mark.asyncio
async def test_place_context_comes_from_seeded_database(test_client: object) -> None:
    """Fresh databases should expose curated place context through the API."""
    response = await test_client.get("/api/places/las-vegas-nv/page-context")

    assert response.status_code == HTTP_OK
    payload = response.json()
    assert payload["place_key"] == "las-vegas-nv"
    assert payload["name"] == "Las Vegas"
    assert payload["kind"] == "polity"
    assert payload["source_dataset"] == "Atlas civic place composition"
    assert payload["source_identifier"] == "atlas:place-composition/las-vegas-nv"
    assert payload["source_url"] is None
    assert payload["summary_facts"] == [
        {"label": "Metro", "value": "Las Vegas-Henderson-Paradise", "attribution": None},
        {"label": "County", "value": "Clark County", "attribution": None},
        {
            "label": "Valley cities",
            "value": "Las Vegas, Henderson, North Las Vegas",
            "attribution": None,
        },
        {"label": "Largest work base", "value": "Tourism, service, logistics", "attribution": None},
        {"label": "Active issues", "value": "Housing, transit, heat, water", "attribution": None},
    ]
    assert [scope["label"] for scope in payload["scopes"]] == [
        "Valley",
        "City",
        "Clark County",
        "Metro",
        "Henderson",
        "North Las Vegas",
    ]
    assert payload["governments"][0]["name"] == "City of Las Vegas"
    assert payload["governments"][0]["links"][0] == {
        "label": "Council agendas",
        "href": "https://www.lasvegasnevada.gov/Government",
    }
    assert [place["kind"] for place in payload["places"]] == ["city", "city"]
    assert payload["places"][0] == {
        "name": "Henderson",
        "href": "/places/cities/henderson-nv",
        "kind": "city",
        "summary": "Housing growth, water, parks, transit access, public safety.",
        "accent": "neutral",
        "latitude": 36.039525,
        "longitude": -114.981721,
        "source_dataset": "U.S. Census Bureau Places",
        "source_identifier": "census:place/3231900",
        "source_url": "https://www.census.gov/programs-surveys/geography.html",
    }


@pytest.mark.asyncio
async def test_place_context_can_be_narrowed_to_route_kind(test_client: object) -> None:
    """Kinded routes should not collapse back to the civic composition page."""
    response = await test_client.get("/api/places/las-vegas-nv/page-context?kind=city")

    assert response.status_code == HTTP_OK
    payload = response.json()
    assert payload["place_key"] == "city:las-vegas-nv"
    assert payload["name"] == "City of Las Vegas"
    assert payload["kind"] == "city"
    assert payload["source_dataset"] == "U.S. Census Bureau Places"
    assert payload["source_identifier"] == "census:place/3240000"
    assert [scope for scope in payload["scopes"] if scope["active"]] == [
        {"label": "City", "href": "/places/cities/las-vegas-nv", "active": True}
    ]
