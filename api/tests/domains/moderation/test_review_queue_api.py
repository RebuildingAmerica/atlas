"""HTTP tests for the discovery review-queue endpoints."""

from http import HTTPStatus

import httpx
import pytest

from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.domains.moderation.review_queue import ReviewQueueCRUD
from atlas.models.database import get_db_connection


async def _seed_held_org(db_url: str, *, name: str) -> tuple[str, str]:
    """Create a held organization and enqueue it; return (entity_id, item_id)."""
    conn = await get_db_connection(db_url)
    try:
        entity_id = await EntryCRUD.create(
            conn,
            entry_type="organization",
            name=name,
            description="Held pending review.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
            active=False,
        )
        item_id = await ReviewQueueCRUD.enqueue(
            conn,
            entity_id=entity_id,
            kind="organization",
            hold_reason="uncorroborated_web_only",
            score=0.5,
            dedup_suspect=False,
            dedup_note=None,
        )
    finally:
        await conn.close()
    return entity_id, item_id


@pytest.mark.asyncio
async def test_list_review_queue_returns_pending_items(
    test_client: httpx.AsyncClient, db_url: str
) -> None:
    _entity_id, item_id = await _seed_held_org(db_url, name="Pending Org")

    response = await test_client.get("/api/review-queue")

    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == item_id
    assert body["items"][0]["hold_reason"] == "uncorroborated_web_only"


@pytest.mark.asyncio
async def test_approve_review_item_publishes_entry(
    test_client: httpx.AsyncClient, db_url: str
) -> None:
    entity_id, item_id = await _seed_held_org(db_url, name="Approve Org")

    response = await test_client.post(f"/api/review-queue/{item_id}/approve")

    assert response.status_code == HTTPStatus.OK
    conn = await get_db_connection(db_url)
    try:
        entry = await EntryCRUD.get_by_id(conn, entity_id)
        pending = await ReviewQueueCRUD.list_pending(conn)
    finally:
        await conn.close()
    assert entry is not None
    assert entry.active is True
    assert pending == []


@pytest.mark.asyncio
async def test_reject_review_item_keeps_entry_inactive(
    test_client: httpx.AsyncClient, db_url: str
) -> None:
    entity_id, item_id = await _seed_held_org(db_url, name="Reject Org")

    response = await test_client.post(f"/api/review-queue/{item_id}/reject")

    assert response.status_code == HTTPStatus.OK
    conn = await get_db_connection(db_url)
    try:
        entry = await EntryCRUD.get_by_id(conn, entity_id)
        pending = await ReviewQueueCRUD.list_pending(conn)
    finally:
        await conn.close()
    assert entry is not None
    assert entry.active is False
    assert pending == []


@pytest.mark.asyncio
async def test_approve_unknown_item_returns_404(test_client: httpx.AsyncClient) -> None:
    response = await test_client.post("/api/review-queue/missing-id/approve")
    assert response.status_code == HTTPStatus.NOT_FOUND


@pytest.mark.asyncio
async def test_reject_unknown_item_returns_404(test_client: httpx.AsyncClient) -> None:
    response = await test_client.post("/api/review-queue/missing-id/reject")
    assert response.status_code == HTTPStatus.NOT_FOUND
