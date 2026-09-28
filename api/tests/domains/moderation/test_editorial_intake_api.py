"""An editor can turn an official source into a held, reviewable profile."""

from http import HTTPStatus
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest

from atlas.domains.moderation.editorial_intake import (
    EditorialCandidateCreateRequest,
    stage_editorial_candidate,
)
from atlas.models import EntryCRUD, SourceCRUD


def candidate(**overrides: object) -> dict[str, object]:
    """Return one source-backed Las Vegas candidate."""
    values: dict[str, object] = {
        "name": "Las Vegans for Better Transit",
        "description": "Las Vegas Valley group organizing residents for better public transit.",
        "city": "Las Vegas",
        "state": "NV",
        "geo_specificity": "regional",
        "region": "Las Vegas Valley",
        "issue_areas": ["public_transit", "transportation_and_mobility"],
        "source_url": "https://lasvegasfortransit.org/about/",
        "source_context": "The About page describes public education, organizing, and transit advocacy.",
        "action_url": "https://lasvegasfortransit.org/join/",
        "sources_checked": True,
    }
    values.update(overrides)
    return values


@pytest.mark.asyncio
async def test_editorial_candidate_requires_review_before_publication(
    test_client: httpx.AsyncClient,
    test_db: object,
) -> None:
    """A source-backed intake stays private until an editor approves its facts."""
    staged = await test_client.post("/api/review-queue/editorial-candidates", json=candidate())

    assert staged.status_code == HTTPStatus.CREATED
    assert staged.headers["cache-control"] == "no-store"
    body = staged.json()
    assert body["status"] == "pending"
    entry = await EntryCRUD.get_by_id(test_db, body["entity_id"])
    assert entry is not None
    assert not entry.active
    assert entry.website == "https://lasvegasfortransit.org/join/"

    public = await test_client.get("/api/entities?query=Las%20Vegans%20for%20Better%20Transit")
    assert public.json()["total"] == 0

    queue = await test_client.get("/api/review-queue")
    item = queue.json()["items"][0]
    assert item["id"] == body["review_item_id"]
    assert item["hold_reason"] == "editorial_candidate"
    assert item["entity_description"] == candidate()["description"]
    assert item["entity_city"] == "Las Vegas"
    assert item["entity_state"] == "NV"
    assert item["entity_website"] == candidate()["action_url"]
    assert item["entity_issue_areas"] == ["public_transit", "transportation_and_mobility"]
    assert item["source_urls"] == [candidate()["source_url"], candidate()["action_url"]]

    approval = await test_client.post(f"/api/review-queue/{body['review_item_id']}/approve")
    assert approval.status_code == HTTPStatus.OK
    published = await test_client.get("/api/entities?query=Las%20Vegans%20for%20Better%20Transit")
    assert published.json()["total"] == 1
    assert published.json()["items"][0]["id"] == body["entity_id"]


@pytest.mark.asyncio
async def test_editorial_candidate_reject_and_duplicate_intake_stay_private(
    test_client: httpx.AsyncClient,
    test_db: object,
) -> None:
    """A retry cannot create a second entry; rejection does not publish the first."""
    first = await test_client.post("/api/review-queue/editorial-candidates", json=candidate())
    repeated = await test_client.post("/api/review-queue/editorial-candidates", json=candidate())
    assert first.status_code == HTTPStatus.CREATED
    assert repeated.status_code == HTTPStatus.CONFLICT
    assert repeated.json()["detail"]["entity_id"] == first.json()["entity_id"]
    rejected = await test_client.post(f"/api/review-queue/{first.json()['review_item_id']}/reject")
    assert rejected.status_code == HTTPStatus.OK
    entry = await EntryCRUD.get_by_id(test_db, first.json()["entity_id"])
    assert entry is not None
    assert not entry.active
    revised = await test_client.post(
        "/api/review-queue/editorial-candidates",
        json=candidate(description="Revised official-site summary for editorial review."),
    )
    assert revised.status_code == HTTPStatus.CREATED
    assert revised.json()["entity_id"] != first.json()["entity_id"]


@pytest.mark.asyncio
async def test_editorial_intake_detects_an_existing_source_on_an_alternate_name(
    test_client: httpx.AsyncClient,
    test_db: object,
) -> None:
    """A different candidate label cannot reuse an existing profile's evidence."""
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Existing Valley Transit Group",
        description="Existing organization with an official source.",
        city="Las Vegas",
        state="NV",
        geo_specificity="regional",
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://lasvegasfortransit.org/about/",
        source_type="org_website",
        extraction_method="manual",
    )
    await SourceCRUD.link_to_entry(test_db, entry_id, source_id)

    response = await test_client.post(
        "/api/review-queue/editorial-candidates",
        json=candidate(name="Valley Transit Advocacy Group"),
    )
    assert response.status_code == HTTPStatus.CONFLICT
    assert response.json()["detail"]["entity_id"] == entry_id


@pytest.mark.asyncio
async def test_editorial_candidate_cannot_publish_after_its_source_is_unlinked(
    test_client: httpx.AsyncClient,
    test_db: object,
) -> None:
    """Approval checks current evidence rather than trusting the original intake."""
    staged = await test_client.post("/api/review-queue/editorial-candidates", json=candidate())
    entity_id = staged.json()["entity_id"]
    source = await SourceCRUD.get_by_url(test_db, str(candidate()["source_url"]))
    assert source is not None
    await SourceCRUD.unlink_from_entry(test_db, entity_id, source.id)

    approval = await test_client.post(
        f"/api/review-queue/{staged.json()['review_item_id']}/approve"
    )
    assert approval.status_code == HTTPStatus.CONFLICT
    entry = await EntryCRUD.get_by_id(test_db, entity_id)
    assert entry is not None
    assert not entry.active


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mutation_sql",
    [
        "DELETE FROM entry_issue_areas WHERE entry_id = ?",
        "UPDATE entries SET website = NULL WHERE id = ?",
    ],
)
async def test_editorial_candidate_cannot_publish_after_reviewed_facts_are_removed(
    test_client: httpx.AsyncClient,
    test_db: object,
    mutation_sql: str,
) -> None:
    """A missing issue tag or official action keeps the held profile private."""
    staged = await test_client.post("/api/review-queue/editorial-candidates", json=candidate())
    assert staged.status_code == HTTPStatus.CREATED
    entity_id = staged.json()["entity_id"]
    await test_db.execute(mutation_sql, (entity_id,))
    await test_db.commit()

    approval = await test_client.post(
        f"/api/review-queue/{staged.json()['review_item_id']}/approve"
    )
    assert approval.status_code == HTTPStatus.CONFLICT
    entry = await EntryCRUD.get_by_id(test_db, entity_id)
    assert entry is not None
    assert not entry.active


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "changes",
    [
        {"name": "   "},
        {"source_url": "http://lasvegasfortransit.org/about/"},
        {"source_url": "https:///about"},
        {"source_url": "https://lasvegasfortransit.org:bad/about/"},
        {"source_url": "https://127.0.0.1/about/"},
        {"action_url": "https://unrelated.example/join"},
        {"issue_areas": ["made_up_issue"]},
        {"issue_areas": ["public_transit", "public_transit"]},
        {"city": None, "geo_specificity": "local"},
        {"sources_checked": False},
    ],
)
async def test_editorial_intake_rejects_unsupported_candidate_fields(
    test_client: httpx.AsyncClient,
    changes: dict[str, object],
) -> None:
    """Invalid source, place, or issue facts cannot create a held record."""
    response = await test_client.post(
        "/api/review-queue/editorial-candidates", json=candidate(**changes)
    )
    assert response.status_code in {HTTPStatus.BAD_REQUEST, HTTPStatus.UNPROCESSABLE_ENTITY}
    queue = await test_client.get("/api/review-queue")
    assert queue.json()["total"] == 0


@pytest.mark.asyncio
async def test_editorial_intake_rolls_back_when_the_private_profile_cannot_be_written() -> None:
    """A failed intake cannot leave a partial profile or a review item behind."""
    conn = AsyncMock()

    async def execute(sql: str, *_args: object) -> AsyncMock:
        if sql.lstrip().startswith("INSERT INTO entries"):
            raise RuntimeError("Simulated write failure")  # noqa: TRY003
        cursor = AsyncMock()
        cursor.fetchone.return_value = None
        return cursor

    conn.execute.side_effect = execute
    request = EditorialCandidateCreateRequest(**candidate())

    with pytest.raises(RuntimeError, match="Simulated write failure"):
        await stage_editorial_candidate(conn, request)

    statements = [call.args[0] for call in conn.execute.await_args_list]
    assert "ROLLBACK" in statements
    conn.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_editorial_intake_requires_an_allowlisted_operator(
    test_client: httpx.AsyncClient,
    test_settings: object,
) -> None:
    """A normal signed-in user cannot stage a public-profile candidate."""
    test_settings.multi_user = True
    internal_token = uuid4().hex
    test_settings.auth_internal_secret = internal_token
    test_settings.operator_allowed_emails = ["editor@rebuildingus.org"]
    ordinary_headers = {
        "X-Atlas-Actor-Email": "visitor@example.org",
        "X-Atlas-Actor-Id": "ordinary-user",
        "X-Atlas-Internal-Secret": internal_token,
    }
    response = await test_client.post(
        "/api/review-queue/editorial-candidates", json=candidate(), headers=ordinary_headers
    )
    assert response.status_code == HTTPStatus.FORBIDDEN
