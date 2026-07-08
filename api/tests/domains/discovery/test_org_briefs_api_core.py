"""Core org brief behavior tests."""
# ruff: noqa

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.discovery.briefs import OrgBriefCRUD

from tests.domains.discovery.org_briefs_support import (
    ORG_ID,
    _brief_payload,
    _create_linked_records,
)


@pytest.mark.asyncio
async def test_list_returns_empty_initially(test_client: object) -> None:
    """A workspace with no briefs should receive an empty collection."""
    response = await test_client.get(f"/api/orgs/{ORG_ID}/briefs")

    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0}


@pytest.mark.asyncio
async def test_create_and_list_brief(
    briefs_capable_test_client: object, test_client: object, test_db: object
) -> None:
    """A private Atlas Brief should persist and appear in the workspace list."""
    entry_id, source_id, run_id = await _create_linked_records(test_db)
    payload = _brief_payload(entry_id, source_id, run_id)

    create_response = await briefs_capable_test_client.post(
        f"/api/orgs/{ORG_ID}/briefs", json=payload
    )

    assert create_response.status_code == 201
    created = create_response.json()
    assert created["org_id"] == ORG_ID
    assert created["title"] == payload["title"]
    assert created["scope"] == payload["scope"]
    assert created["summary"] == payload["summary"]
    assert created["linked_entry_ids"] == [entry_id]
    assert created["linked_source_ids"] == [source_id]
    assert created["linked_discovery_run_ids"] == [run_id]
    assert created["confidence_summary"] == payload["confidence_summary"]
    assert created["gaps"] == payload["gaps"]
    assert created["created_by"] == "local-user"
    assert created["created_at"]
    assert created["updated_at"]

    list_response = await test_client.get(f"/api/orgs/{ORG_ID}/briefs")
    assert list_response.status_code == 200
    listed = list_response.json()
    assert listed["total"] == 1
    assert listed["items"][0]["id"] == created["id"]
    assert listed["items"][0]["title"] == payload["title"]


@pytest.mark.asyncio
async def test_get_brief(
    briefs_capable_test_client: object, test_client: object, test_db: object
) -> None:
    """A workspace should be able to reload one of its private briefs."""
    entry_id, source_id, run_id = await _create_linked_records(test_db)
    create_response = await briefs_capable_test_client.post(
        f"/api/orgs/{ORG_ID}/briefs",
        json=_brief_payload(entry_id, source_id, run_id),
    )
    brief_id = create_response.json()["id"]

    get_response = await test_client.get(f"/api/orgs/{ORG_ID}/briefs/{brief_id}")

    assert get_response.status_code == 200
    assert get_response.json()["id"] == brief_id
    assert await OrgUsageEventCRUD.count_by_type(test_db, org_id=ORG_ID) == {"brief_opened": 1}


@pytest.mark.asyncio
async def test_update_brief_reports_missing_brief(briefs_capable_test_client: object) -> None:
    """Updates should fail plainly when the brief no longer exists."""
    response = await briefs_capable_test_client.patch(
        f"/api/orgs/{ORG_ID}/briefs/missing",
        json={},
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_brief_requires_fields(
    briefs_capable_test_client: object, test_db: object
) -> None:
    """Blank updates should be rejected before they reach persistence."""
    entry_id, source_id, run_id = await _create_linked_records(test_db)
    create_response = await briefs_capable_test_client.post(
        f"/api/orgs/{ORG_ID}/briefs",
        json=_brief_payload(entry_id, source_id, run_id),
    )
    brief_id = create_response.json()["id"]

    response = await briefs_capable_test_client.patch(
        f"/api/orgs/{ORG_ID}/briefs/{brief_id}",
        json={},
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_update_brief_reports_missing_after_persistence(
    briefs_capable_test_client: object,
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If the update disappears mid-write, the route should fail closed."""
    entry_id, source_id, run_id = await _create_linked_records(test_db)
    create_response = await briefs_capable_test_client.post(
        f"/api/orgs/{ORG_ID}/briefs",
        json=_brief_payload(entry_id, source_id, run_id),
    )
    brief_id = create_response.json()["id"]

    monkeypatch.setattr(OrgBriefCRUD, "update", AsyncMock(return_value=None))

    response = await briefs_capable_test_client.patch(
        f"/api/orgs/{ORG_ID}/briefs/{brief_id}",
        json={"title": "Updated title"},
    )

    assert response.status_code == 404
