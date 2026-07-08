"""Org brief validation tests."""
# ruff: noqa

from __future__ import annotations

import pytest
from atlas.domains.catalog.models.ownership import OwnershipCRUD

from tests.domains.discovery.org_briefs_support import (
    ORG_ID,
    OTHER_ORG_ID,
    _brief_payload,
    _create_linked_records,
)


@pytest.mark.asyncio
async def test_create_rejects_unknown_source_link(
    briefs_capable_test_client: object, test_db: object
) -> None:
    """A brief cannot claim a source receipt that does not exist."""
    entry_id, _source_id, run_id = await _create_linked_records(test_db)
    payload = _brief_payload(entry_id, "missing-source", run_id)

    response = await briefs_capable_test_client.post(f"/api/orgs/{ORG_ID}/briefs", json=payload)

    assert response.status_code == 404
    assert response.json()["detail"] == "Source not found"


@pytest.mark.asyncio
async def test_create_rejects_unknown_entry_link(
    briefs_capable_test_client: object, test_db: object
) -> None:
    """A brief cannot claim an actor that does not exist."""
    _entry_id, source_id, run_id = await _create_linked_records(test_db)
    payload = _brief_payload("missing-entry", source_id, run_id)

    response = await briefs_capable_test_client.post(f"/api/orgs/{ORG_ID}/briefs", json=payload)

    assert response.status_code == 404
    assert response.json()["detail"] == "Entry not found"


@pytest.mark.asyncio
async def test_create_rejects_unknown_discovery_run_link(
    briefs_capable_test_client: object, test_db: object
) -> None:
    """A brief cannot claim research context that does not exist."""
    entry_id, source_id, _run_id = await _create_linked_records(test_db)
    payload = _brief_payload(entry_id, source_id, "missing-run")

    response = await briefs_capable_test_client.post(f"/api/orgs/{ORG_ID}/briefs", json=payload)

    assert response.status_code == 404
    assert response.json()["detail"] == "Discovery run not found"


@pytest.mark.asyncio
async def test_create_rejects_resource_owned_by_another_workspace(
    briefs_capable_test_client: object, test_db: object
) -> None:
    """Workspace briefs cannot launder another workspace's private actor context."""
    entry_id, source_id, run_id = await _create_linked_records(test_db)
    await OwnershipCRUD.create_ownership(
        test_db,
        resource_id=entry_id,
        resource_type="entry",
        org_id=OTHER_ORG_ID,
        visibility="private",
        created_by="other-user",
    )
    payload = _brief_payload(entry_id, source_id, run_id)

    response = await briefs_capable_test_client.post(f"/api/orgs/{ORG_ID}/briefs", json=payload)

    assert response.status_code == 404
    assert response.json()["detail"] == "Entry not found"


@pytest.mark.asyncio
async def test_get_unknown_brief_returns_not_found(test_client: object) -> None:
    """Unknown private brief IDs should not expose workspace artifact details."""
    response = await test_client.get(f"/api/orgs/{ORG_ID}/briefs/missing-brief")

    assert response.status_code == 404
    assert response.json()["detail"] == "Brief not found"


@pytest.mark.asyncio
async def test_create_rejects_empty_evidence_links(briefs_capable_test_client: object) -> None:
    """A sellable brief needs at least one linked entity, source, or run."""
    payload = _brief_payload("entry-id", "source-id", "run-id")
    payload["linked_entry_ids"] = []
    payload["linked_source_ids"] = []
    payload["linked_discovery_run_ids"] = []

    response = await briefs_capable_test_client.post(f"/api/orgs/{ORG_ID}/briefs", json=payload)

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "At least one linked entry, source, or discovery run is required."
    )
