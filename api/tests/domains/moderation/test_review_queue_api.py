"""HTTP tests for the discovery review-queue endpoints."""

from datetime import UTC, date, datetime, timedelta
from http import HTTPStatus

import httpx
import pytest

from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.catalog.models.source import SourceCRUD
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


async def _seed_public_org_with_source(
    db_url: str,
    *,
    name: str,
    published_date: date,
) -> str:
    """Create a public organization with one dated source receipt."""
    conn = await get_db_connection(db_url)
    try:
        entity_id = await EntryCRUD.create(
            conn,
            entry_type="organization",
            name=name,
            description="Public record with source evidence.",
            city="Milwaukee",
            state="WI",
            geo_specificity="local",
            active=True,
        )
        source_id = await SourceCRUD.create(
            conn,
            url=f"https://example.test/{entity_id}",
            source_type="news_article",
            extraction_method="manual",
            title=f"{name} source",
            publication="Civic Desk",
            published_date=published_date,
        )
        await SourceCRUD.link_to_entry(conn, entity_id, source_id)
        await OwnershipCRUD.create_ownership(
            conn,
            resource_id=entity_id,
            resource_type="entry",
            org_id="local",
            visibility="public",
            created_by="test",
        )
    finally:
        await conn.close()
    return entity_id


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
async def test_source_staleness_scan_enqueues_stale_public_records_once(
    test_client: httpx.AsyncClient, db_url: str
) -> None:
    """Public records with stale source receipts should land in the review queue."""
    today = datetime.now(UTC).date()
    stale_entity_id = await _seed_public_org_with_source(
        db_url,
        name="Stale Public Org",
        published_date=today - timedelta(days=400),
    )
    await _seed_public_org_with_source(
        db_url,
        name="Fresh Public Org",
        published_date=today,
    )

    response = await test_client.post("/api/review-queue/source-staleness-scan")
    duplicate_response = await test_client.post("/api/review-queue/source-staleness-scan")

    assert response.status_code == HTTPStatus.OK
    assert response.json()["enqueued"] == 1
    assert duplicate_response.status_code == HTTPStatus.OK
    assert duplicate_response.json()["enqueued"] == 0

    conn = await get_db_connection(db_url)
    try:
        pending = await ReviewQueueCRUD.list_pending(conn)
    finally:
        await conn.close()

    assert len(pending) == 1
    assert pending[0].entity_id == stale_entity_id
    assert pending[0].org_id == "local"
    assert pending[0].kind == "source_staleness"
    assert pending[0].hold_reason == "stale_public_source_review"


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
