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
    assert payload["places"][0] == {
        "name": "The Strip",
        "href": "/places/neighborhoods/the-strip-nv",
        "kind": "corridor",
        "summary": "Hospitality labor, tourism economy, transit access, public safety.",
        "accent": "labor",
        "latitude": 36.114647,
        "longitude": -115.172813,
    }
