"""Moderation API tests."""
# ruff: noqa

from __future__ import annotations

from datetime import date
from http import HTTPStatus

import pytest
from fastapi import HTTPException

from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.moderation.api import require_moderation_editor
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
    assert entity_flag_response.json().keys() == {"id", "status", "created_at"}
    assert source_flag_response.json().keys() == {"id", "status", "created_at"}
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
    assert entity_flags.json()["items"][0]["note"] == (
        "Review before surfacing this profile more widely."
    )


@pytest.mark.asyncio
async def test_entity_and_source_flag_alternate_actions_succeed(
    test_client: object,
    test_db: object,
) -> None:
    """The alternate flag actions should also return successful updates."""
    entity_id = await EntryCRUD.create(
        test_db,
        entry_type="person",
        name="Alternate Flag Person",
        description="Person record for moderation workflow tests.",
        city="Detroit",
        state="MI",
        geo_specificity="local",
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.test/alternate-flag-source",
        source_type="news_article",
        extraction_method="manual",
        title="Alternate flag source",
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
    dismiss_entity_response = await test_client.post(f"/api/entity-flags/{entity_flag_id}/dismiss")
    resolve_source_response = await test_client.post(f"/api/source-flags/{source_flag_id}/resolve")

    assert dismiss_entity_response.status_code == HTTPStatus.OK
    assert dismiss_entity_response.json()["status"] == "reviewed"
    assert resolve_source_response.status_code == HTTPStatus.OK
    assert resolve_source_response.json()["status"] == "resolved"


@pytest.mark.asyncio
async def test_missing_moderation_flags_reject_resolution_attempts(test_client: object) -> None:
    """Missing flags should 404 on both the resolve and dismiss flows."""
    responses = [
        await test_client.post("/api/entity-flags/missing-entity/resolve"),
        await test_client.post("/api/entity-flags/missing-entity/dismiss"),
        await test_client.post("/api/source-flags/missing-source/resolve"),
        await test_client.post("/api/source-flags/missing-source/dismiss"),
    ]

    assert all(response.status_code == HTTPStatus.NOT_FOUND for response in responses)


@pytest.mark.asyncio
async def test_anonymous_callers_cannot_read_private_correction_notes(
    test_client: object,
    test_db: object,
    test_settings: object,
) -> None:
    """A public report receipt must not reveal or make its note retrievable."""
    entity_id = await EntryCRUD.create(
        test_db,
        entry_type="person",
        name="Privacy Report Person",
        description="A profile with a private correction.",
        city="Las Vegas",
        state="NV",
        geo_specificity="local",
    )
    response = await test_client.post(
        "/api/entity-flags",
        json={"entity_id": entity_id, "reason": "incorrect", "note": "Private contact details"},
    )
    assert response.status_code == HTTPStatus.CREATED
    assert "Private contact details" not in response.text

    test_settings.multi_user = True
    listing = await test_client.get(f"/api/entity-flags?entity_id={entity_id}")
    assert listing.status_code == HTTPStatus.UNAUTHORIZED


@pytest.mark.asyncio
async def test_profile_correction_inbox_lists_open_reports_with_profile_context(
    test_client: object,
    test_db: object,
) -> None:
    """Editors can find private reports without knowing each profile ID in advance."""
    first_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="First Las Vegas Group",
        description="A group with a public profile correction.",
        city="Las Vegas",
        state="NV",
        geo_specificity="local",
    )
    second_id = await EntryCRUD.create(
        test_db,
        entry_type="person",
        name="Second Las Vegas Organizer",
        description="A person with a missing context report.",
        city="Las Vegas",
        state="NV",
        geo_specificity="local",
    )
    first = await test_client.post(
        "/api/entity-flags",
        json={"entity_id": first_id, "reason": "incorrect", "note": "Private correction one"},
    )
    second = await test_client.post(
        "/api/entity-flags",
        json={"entity_id": second_id, "reason": "missing_context", "note": "Private note two"},
    )

    inbox = await test_client.get("/api/entity-flags/inbox?limit=1&offset=0")
    assert inbox.status_code == HTTPStatus.OK
    assert inbox.headers["cache-control"] == "no-store"
    assert inbox.json()["total"] == 2
    first_entry = await EntryCRUD.get_by_id(test_db, first_id)
    assert first_entry is not None
    assert inbox.json()["items"][0] == {
        "id": first.json()["id"],
        "entity_id": first_id,
        "entity_name": "First Las Vegas Group",
        "entity_slug": first_entry.slug,
        "entity_type": "organization",
        "reason": "incorrect",
        "note": "Private correction one",
        "created_at": first.json()["created_at"],
    }

    next_page = await test_client.get("/api/entity-flags/inbox?limit=1&offset=1")
    assert [item["id"] for item in next_page.json()["items"]] == [second.json()["id"]]
    await test_client.post(f"/api/entity-flags/{first.json()['id']}/resolve")
    remaining = await test_client.get("/api/entity-flags/inbox")
    assert [item["id"] for item in remaining.json()["items"]] == [second.json()["id"]]


@pytest.mark.asyncio
async def test_editor_inbox_includes_open_source_reports_and_profile_reports(
    test_client: object,
    test_db: object,
) -> None:
    """An editor sees source reports without knowing the source ID in advance."""
    entity_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Las Vegas Housing Group",
        description="A group with a reported profile.",
        city="Las Vegas",
        state="NV",
        geo_specificity="local",
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.test/housing-evidence",
        source_type="org_website",
        extraction_method="manual",
        title="Housing evidence",
    )
    await SourceCRUD.link_to_entry(test_db, entity_id, source_id)
    linked_entry = await EntryCRUD.get_by_id(test_db, entity_id)
    assert linked_entry is not None
    second_entity_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Nevada Tenant Network",
        description="Another group that uses the same source.",
        city="Las Vegas",
        state="NV",
        geo_specificity="local",
    )
    await SourceCRUD.link_to_entry(test_db, second_entity_id, source_id)
    second_entry = await EntryCRUD.get_by_id(test_db, second_entity_id)
    assert second_entry is not None
    profile_receipt = await test_client.post(
        "/api/entity-flags",
        json={"entity_id": entity_id, "reason": "incorrect", "note": "Private profile note"},
    )
    source_receipt = await test_client.post(
        "/api/source-flags",
        json={"source_id": source_id, "reason": "outdated_source", "note": "Private source note"},
    )

    inbox = await test_client.get("/api/correction-inbox?limit=1&offset=0")
    assert inbox.status_code == HTTPStatus.OK
    assert inbox.headers["cache-control"] == "no-store"
    assert inbox.json()["total"] == 2
    assert inbox.json()["items"][0]["id"] == profile_receipt.json()["id"]

    next_page = await test_client.get("/api/correction-inbox?limit=1&offset=1")
    assert next_page.json()["items"] == [
        {
            "id": source_receipt.json()["id"],
            "target_type": "source",
            "target_id": source_id,
            "target_name": "Housing evidence",
            "entity_slug": None,
            "entity_type": None,
            "source_url": "https://example.test/housing-evidence",
            "linked_profiles": [
                {
                    "name": "Las Vegas Housing Group",
                    "slug": linked_entry.slug,
                    "type": "organization",
                },
                {
                    "name": "Nevada Tenant Network",
                    "slug": second_entry.slug,
                    "type": "organization",
                },
            ],
            "reason": "outdated_source",
            "note": "Private source note",
            "created_at": source_receipt.json()["created_at"],
        }
    ]
    await test_client.post(f"/api/source-flags/{source_receipt.json()['id']}/resolve")
    remaining = await test_client.get("/api/correction-inbox")
    assert remaining.json()["total"] == 1
    assert remaining.json()["items"][0]["id"] == profile_receipt.json()["id"]


@pytest.mark.asyncio
async def test_anonymous_callers_cannot_list_profile_correction_inbox(
    test_client: object,
    test_settings: object,
) -> None:
    """The editor inbox never becomes a public way to enumerate private notes."""
    test_settings.multi_user = True
    response = await test_client.get("/api/entity-flags/inbox")
    assert response.status_code == HTTPStatus.UNAUTHORIZED
    combined = await test_client.get("/api/correction-inbox")
    assert combined.status_code == HTTPStatus.UNAUTHORIZED


@pytest.mark.asyncio
async def test_only_allowlisted_editors_can_read_or_close_private_reports(
    test_client: object,
    test_db: object,
    test_settings: object,
) -> None:
    """A normal signed-in user cannot use internal app auth to read notes or close reports."""
    entity_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Reported Group",
        description="A group with a private visitor correction.",
        city="Las Vegas",
        state="NV",
        geo_specificity="local",
    )
    receipt = await test_client.post(
        "/api/entity-flags",
        json={"entity_id": entity_id, "reason": "incorrect", "note": "Private report"},
    )
    report_id = receipt.json()["id"]
    source_id = await SourceCRUD.create(
        test_db,
        url="https://example.test/reported-source",
        source_type="news_article",
        extraction_method="manual",
        title="Reported source",
    )
    source_receipt = await test_client.post(
        "/api/source-flags",
        json={"source_id": source_id, "reason": "outdated_source", "note": "Private source note"},
    )
    source_report_id = source_receipt.json()["id"]
    test_internal_secret = "internal-test-secret"  # pragma: allowlist secret
    test_settings.multi_user = True
    test_settings.auth_internal_secret = test_internal_secret
    test_settings.operator_allowed_emails = ["editor@rebuildingus.org"]
    ordinary_headers = {
        "X-Atlas-Actor-Email": "visitor@example.org",
        "X-Atlas-Actor-Id": "ordinary-user",
        "X-Atlas-Internal-Secret": test_internal_secret,
    }
    editor_headers = {
        "X-Atlas-Actor-Email": "EDITOR@rebuildingus.org",
        "X-Atlas-Actor-Id": "editor-user",
        "X-Atlas-Internal-Secret": test_internal_secret,
    }

    for path in (
        "/api/entity-flags/inbox",
        "/api/correction-inbox",
        f"/api/entity-flags?entity_id={entity_id}",
        f"/api/source-flags?source_id={source_id}",
        "/api/review-queue",
    ):
        denied = await test_client.get(path, headers=ordinary_headers)
        assert denied.status_code == HTTPStatus.FORBIDDEN
    denied_decision = await test_client.post(
        f"/api/entity-flags/{report_id}/resolve", headers=ordinary_headers
    )
    assert denied_decision.status_code == HTTPStatus.FORBIDDEN
    denied_source_decision = await test_client.post(
        f"/api/source-flags/{source_report_id}/dismiss", headers=ordinary_headers
    )
    assert denied_source_decision.status_code == HTTPStatus.FORBIDDEN
    denied_review_decision = await test_client.post(
        "/api/review-queue/nonexistent/approve", headers=ordinary_headers
    )
    assert denied_review_decision.status_code == HTTPStatus.FORBIDDEN

    inbox = await test_client.get("/api/entity-flags/inbox", headers=editor_headers)
    assert inbox.status_code == HTTPStatus.OK
    assert inbox.json()["items"][0]["note"] == "Private report"
    combined_inbox = await test_client.get("/api/correction-inbox", headers=editor_headers)
    assert combined_inbox.status_code == HTTPStatus.OK
    assert combined_inbox.json()["total"] == 2
    assert (
        next(item for item in combined_inbox.json()["items"] if item["target_type"] == "source")[
            "linked_profiles"
        ]
        == []
    )
    resolved = await test_client.post(
        f"/api/entity-flags/{report_id}/resolve", headers=editor_headers
    )
    assert resolved.status_code == HTTPStatus.OK
    assert resolved.json()["status"] == "resolved"


@pytest.mark.asyncio
async def test_discovery_api_key_cannot_become_a_moderation_editor(test_settings: object) -> None:
    """A scoped customer credential cannot read reporter notes even with an allowed email."""
    test_settings.operator_allowed_emails = [" ", "editor@rebuildingus.org"]
    actor = AuthenticatedActor(
        user_id="customer-key-user",
        email="editor@rebuildingus.org",
        auth_type="api_key",
        permissions={"discovery": ["write"]},
    )
    with pytest.raises(HTTPException) as exc:
        await require_moderation_editor(actor=actor, settings=test_settings)
    assert exc.value.status_code == HTTPStatus.FORBIDDEN
