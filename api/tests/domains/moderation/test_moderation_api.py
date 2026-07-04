"""Moderation API tests."""

from __future__ import annotations

from datetime import date
from http import HTTPStatus

import pytest

from atlas.models import EntryCRUD, SourceCRUD


@pytest.mark.asyncio
async def test_flag_creation_rejects_missing_entities_and_sources(test_client: object) -> None:
    """Anonymous flag routes should 404 when the target record is missing."""
    entity_response = await test_client.post(
        "/api/entity-flags",
        json={
            "entity_id": "missing-entity",
            "reason": "stale_information",
            "note": "Could not verify this record.",
        },
    )
    source_response = await test_client.post(
        "/api/source-flags",
        json={
            "source_id": "missing-source",
            "reason": "broken_link",
            "note": "The source no longer resolves.",
        },
    )

    assert entity_response.status_code == HTTPStatus.NOT_FOUND
    assert source_response.status_code == HTTPStatus.NOT_FOUND


@pytest.mark.asyncio
async def test_entity_and_source_flags_have_moderation_status_workflows(
    test_client: object,
    test_db: object,
) -> None:
    """Corrections, disputes, and sensitive-person reports should be closeable."""
    entity_id = await EntryCRUD.create(
        test_db,
        entry_type="person",
        name="Sensitive Person",
        description="Person record for moderation workflow tests.",
        city="Detroit",
        state="MI",
        geo_specificity="local",
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.test/sensitive-person-source",
        source_type="news_article",
        extraction_method="manual",
        title="Sensitive person source",
        publication="Civic Desk",
        published_date=date(2026, 1, 1),
    )
    await SourceCRUD.link_to_entry(test_db, entity_id, source_id)
    entity_flag_response = await test_client.post(
        "/api/entity-flags",
        json={
            "entity_id": entity_id,
            "reason": "sensitive_person",
            "note": "Review before surfacing this profile more widely.",
        },
    )
    source_flag_response = await test_client.post(
        "/api/source-flags",
        json={"source_id": source_id, "reason": "outdated_source"},
    )

    entity_flag_id = entity_flag_response.json()["id"]
    source_flag_id = source_flag_response.json()["id"]
    resolve_response = await test_client.post(f"/api/entity-flags/{entity_flag_id}/resolve")
    dismiss_response = await test_client.post(f"/api/source-flags/{source_flag_id}/dismiss")
    entity_flags = await test_client.get(f"/api/entity-flags?entity_id={entity_id}")
    source_flags = await test_client.get(f"/api/source-flags?source_id={source_id}")

    assert resolve_response.status_code == HTTPStatus.OK
    assert resolve_response.json()["status"] == "resolved"
    assert resolve_response.json()["reason"] == "sensitive_person"
    assert dismiss_response.status_code == HTTPStatus.OK
    assert dismiss_response.json()["status"] == "reviewed"
    assert entity_flags.json()["items"][0]["status"] == "resolved"
    assert source_flags.json()["items"][0]["status"] == "reviewed"
