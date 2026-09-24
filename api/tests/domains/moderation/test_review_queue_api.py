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
    published_date: date | None,
) -> str:
    """Create a public organization with one source receipt."""
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
    assert body["items"][0]["entity_name"] == "Pending Org"
    assert body["items"][0]["entity_type"] == "organization"


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
    undated_entity_id = await _seed_public_org_with_source(
        db_url,
        name="Undated Public Org",
        published_date=None,
    )

    response = await test_client.post("/api/review-queue/source-staleness-scan")
    duplicate_response = await test_client.post("/api/review-queue/source-staleness-scan")

    assert response.status_code == HTTPStatus.OK
    assert response.json()["enqueued"] == 2
    assert duplicate_response.status_code == HTTPStatus.OK
    assert duplicate_response.json()["enqueued"] == 0

    conn = await get_db_connection(db_url)
    try:
        pending = await ReviewQueueCRUD.list_pending(conn)
    finally:
        await conn.close()

    assert {item.entity_id for item in pending} == {stale_entity_id, undated_entity_id}
    assert {item.org_id for item in pending} == {"local"}
    assert {item.kind for item in pending} == {"source_staleness"}
    assert {item.hold_reason for item in pending} == {"stale_public_source_review"}
    assert {item.dedup_note for item in pending} == {
        f"Latest source date: {(today - timedelta(days=400)).isoformat()}",
        "No dated source",
    }


@pytest.mark.asyncio
async def test_website_scan_stages_las_vegas_official_source_until_review(
    test_client: httpx.AsyncClient, db_url: str
) -> None:
    """An editor must approve a linked site before it becomes a public contact action."""
    conn = await get_db_connection(db_url)
    try:
        entity_id = await EntryCRUD.create(
            conn,
            entry_type="organization",
            name="Las Vegas Neighborhood Coalition",
            description="Neighbors organizing in the Las Vegas valley.",
            city="Las Vegas",
            state="NV",
            geo_specificity="local",
            active=True,
        )
        source_id = await SourceCRUD.create(
            conn,
            url="https://lv-neighbors.example/about",
            source_type="org_website",
            extraction_method="manual",
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

    path = "/api/review-queue/website-candidate-scan?city=Las%20Vegas&state=NV"
    first = await test_client.post(path)
    second = await test_client.post(path)

    assert first.status_code == HTTPStatus.OK
    assert first.json()["enqueued"] == 1
    assert second.json()["enqueued"] == 0
    conn = await get_db_connection(db_url)
    try:
        pending = await ReviewQueueCRUD.list_pending(conn)
        before = await EntryCRUD.get_by_id(conn, entity_id)
    finally:
        await conn.close()
    assert before is not None
    assert before.website is None
    assert len(pending) == 1
    assert pending[0].entity_id == entity_id
    assert pending[0].proposed_changes == {
        "website": {"before": None, "after": "https://lv-neighbors.example/about"}
    }
    assert pending[0].source_urls == ["https://lv-neighbors.example/about"]

    approval = await test_client.post(f"/api/review-queue/{pending[0].id}/approve")
    assert approval.status_code == HTTPStatus.OK
    conn = await get_db_connection(db_url)
    try:
        after = await EntryCRUD.get_by_id(conn, entity_id)
    finally:
        await conn.close()
    assert after is not None
    assert after.website == "https://lv-neighbors.example/about"


@pytest.mark.asyncio
async def test_website_scan_does_not_reopen_rejected_contact_candidate(
    test_client: httpx.AsyncClient, db_url: str
) -> None:
    """A reviewer decision should survive later scans of the same source."""
    conn = await get_db_connection(db_url)
    try:
        entity_id = await EntryCRUD.create(
            conn,
            entry_type="organization",
            name="Rejected Contact Org",
            description="An organization whose source is not a public contact.",
            city="Las Vegas",
            state="NV",
            geo_specificity="local",
            active=True,
        )
        source_id = await SourceCRUD.create(
            conn,
            url="https://not-contact.example/about",
            source_type="org_website",
            extraction_method="manual",
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

    path = "/api/review-queue/website-candidate-scan?city=Las%20Vegas&state=NV"
    first = await test_client.post(path)
    item_id = first.json()["review_item_ids"][0]
    rejected = await test_client.post(f"/api/review-queue/{item_id}/reject")
    repeat = await test_client.post(path)

    assert rejected.status_code == HTTPStatus.OK
    assert repeat.status_code == HTTPStatus.OK
    assert repeat.json()["enqueued"] == 0


@pytest.mark.asyncio
async def test_website_scan_skips_ambiguous_and_unsafe_sources(
    test_client: httpx.AsyncClient, db_url: str
) -> None:
    """Do not offer an arbitrary site, stale contact overwrite, or non-site article."""
    conn = await get_db_connection(db_url)
    try:
        cases = [
            (
                "Two sites",
                "Las Vegas",
                None,
                ["https://first.example", "https://second.example"],
                "org_website",
            ),
            ("Article only", "Las Vegas", None, ["https://news.example/story"], "news_article"),
            ("Other city", "Henderson", None, ["https://henderson.example"], "org_website"),
            (
                "Already listed",
                "Las Vegas",
                "https://listed.example",
                ["https://listed.example"],
                "org_website",
            ),
            ("Unsafe site", "Las Vegas", None, ["http://unsafe.example"], "org_website"),
        ]
        for name, city, website, urls, source_type in cases:
            entity_id = await EntryCRUD.create(
                conn,
                entry_type="organization",
                name=name,
                description="A test organization with a public source.",
                city=city,
                state="NV",
                geo_specificity="local",
                website=website,
                active=True,
            )
            for url in urls:
                source_id = await SourceCRUD.create(
                    conn,
                    url=url,
                    source_type=source_type,
                    extraction_method="manual",
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

    response = await test_client.post(
        "/api/review-queue/website-candidate-scan?city=Las%20Vegas&state=NV"
    )
    assert response.status_code == HTTPStatus.OK
    assert response.json() == {"enqueued": 0, "review_item_ids": []}


@pytest.mark.asyncio
async def test_website_scan_skips_directory_url_shared_by_multiple_profiles(
    test_client: httpx.AsyncClient, db_url: str
) -> None:
    """A common directory page is evidence, not each group's own website."""
    conn = await get_db_connection(db_url)
    try:
        source_id = await SourceCRUD.create(
            conn,
            url="https://city.example/boards",
            source_type="org_website",
            extraction_method="manual",
        )
        for name in ("Transit Board", "Housing Board"):
            entity_id = await EntryCRUD.create(
                conn,
                entry_type="organization",
                name=name,
                description="A city advisory body with a shared directory source.",
                city="Las Vegas",
                state="NV",
                geo_specificity="local",
                active=True,
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

    response = await test_client.post(
        "/api/review-queue/website-candidate-scan?city=Las%20Vegas&state=NV"
    )

    assert response.status_code == HTTPStatus.OK
    assert response.json()["enqueued"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("source_change", ["unlink", "share"])
async def test_website_scan_approval_rechecks_linked_source(
    test_client: httpx.AsyncClient, db_url: str, source_change: str
) -> None:
    """A removed or newly shared source cannot publish a contact URL later."""
    conn = await get_db_connection(db_url)
    try:
        entity_id = await EntryCRUD.create(
            conn,
            entry_type="organization",
            name="Source Removed Org",
            description="A public organization with a removed source.",
            city="Las Vegas",
            state="NV",
            geo_specificity="local",
            active=True,
        )
        source_id = await SourceCRUD.create(
            conn,
            url="https://removed.example",
            source_type="org_website",
            extraction_method="manual",
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

    scan = await test_client.post(
        "/api/review-queue/website-candidate-scan?city=Las%20Vegas&state=NV"
    )
    item_id = scan.json()["review_item_ids"][0]
    conn = await get_db_connection(db_url)
    try:
        if source_change == "unlink":
            await SourceCRUD.unlink_from_entry(conn, entity_id, source_id)
        else:
            other_id = await EntryCRUD.create(
                conn,
                entry_type="organization",
                name="Another Organization",
                description="Another organization now linked to the same source.",
                city="Henderson",
                state="NV",
                geo_specificity="local",
                active=True,
            )
            await SourceCRUD.link_to_entry(conn, other_id, source_id)
    finally:
        await conn.close()

    approval = await test_client.post(f"/api/review-queue/{item_id}/approve")
    assert approval.status_code == HTTPStatus.CONFLICT
    conn = await get_db_connection(db_url)
    try:
        entry = await EntryCRUD.get_by_id(conn, entity_id)
        review = await ReviewQueueCRUD.get_by_id(conn, item_id)
    finally:
        await conn.close()
    assert entry is not None
    assert entry.website is None
    assert review is not None
    assert review.status == "pending"


@pytest.mark.asyncio
async def test_website_scan_requires_discovery_write_permission(
    test_client: httpx.AsyncClient, test_settings: object
) -> None:
    test_settings.multi_user = True

    response = await test_client.post(
        "/api/review-queue/website-candidate-scan?city=Las%20Vegas&state=NV"
    )

    assert response.status_code == HTTPStatus.UNAUTHORIZED


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
async def test_stale_public_change_returns_conflict_and_preserves_review(
    test_client: httpx.AsyncClient, db_url: str
) -> None:
    conn = await get_db_connection(db_url)
    try:
        entity_id = await EntryCRUD.create(
            conn,
            entry_type="organization",
            name="Edited Org",
            description="Original.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
            active=True,
        )
        item_id = await ReviewQueueCRUD.enqueue(
            conn,
            entity_id=entity_id,
            kind="organization",
            hold_reason="published_profile_change",
            score=None,
            dedup_suspect=False,
            dedup_note=None,
            proposed_changes={"description": {"before": "Original.", "after": "Proposed."}},
            source_urls=["https://example.org/new-work"],
        )
        await EntryCRUD.update(conn, entity_id, description="Curator update.")
    finally:
        await conn.close()

    listed = await test_client.get("/api/review-queue")
    response = await test_client.post(f"/api/review-queue/{item_id}/approve")

    assert listed.status_code == HTTPStatus.OK
    assert listed.json()["items"][0]["proposed_changes"]["description"]["after"] == "Proposed."
    assert listed.json()["items"][0]["source_urls"] == ["https://example.org/new-work"]
    assert response.status_code == HTTPStatus.CONFLICT
    conn = await get_db_connection(db_url)
    try:
        item = await ReviewQueueCRUD.get_by_id(conn, item_id)
    finally:
        await conn.close()
    assert item is not None
    assert item.status == "pending"


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
