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
    assert entry.website == candidate()["source_url"]
    assert entry.action_url == candidate()["action_url"]

    public = await test_client.get("/api/entities?query=Las%20Vegans%20for%20Better%20Transit")
    assert public.json()["total"] == 0

    queue = await test_client.get("/api/review-queue")
    item = queue.json()["items"][0]
    assert item["id"] == body["review_item_id"]
    assert item["hold_reason"] == "editorial_candidate"
    assert item["entity_description"] == candidate()["description"]
    assert item["entity_city"] == "Las Vegas"
    assert item["entity_state"] == "NV"
    assert item["entity_website"] == candidate()["source_url"]
    assert item["entity_issue_areas"] == ["public_transit", "transportation_and_mobility"]
    assert item["source_urls"] == [candidate()["source_url"], candidate()["action_url"]]
    assert item["source_evidence"] == [
        {
            "url": candidate()["source_url"],
            "context": candidate()["source_context"],
        },
        {
            "url": candidate()["action_url"],
            "context": "Official next step supplied for editorial review.",
        },
    ]
    assert item["proposed_changes"]["description"]["after"] == candidate()["description"]
    assert item["proposed_changes"]["source_evidence"]["after"] == item["source_evidence"]

    approval = await test_client.post(f"/api/review-queue/{body['review_item_id']}/approve")
    assert approval.status_code == HTTPStatus.OK
    published = await test_client.get("/api/entities?query=Las%20Vegans%20for%20Better%20Transit")
    assert published.json()["total"] == 1
    assert published.json()["items"][0]["id"] == body["entity_id"]
    assert published.json()["items"][0]["contact"]["website"] == candidate()["source_url"]
    assert published.json()["items"][0]["action_url"] == candidate()["action_url"]


@pytest.mark.asyncio
async def test_regional_candidate_without_a_verified_city_keeps_its_region_without_a_false_map_point(
    test_client: httpx.AsyncClient,
    test_db: object,
) -> None:
    response = await test_client.post(
        "/api/review-queue/editorial-candidates",
        json=candidate(
            name="Southern Nevada Bicycle Coalition",
            description="Southern Nevada coalition advocating safer roads and more bicycling.",
            city=None,
            region="Southern Nevada",
            issue_areas=["transportation_and_mobility"],
            source_url="https://www.snvbc.org/",
            source_context="The official site describes bicycle advocacy across Southern Nevada.",
            action_url="https://www.snvbc.org/join-for-free/",
        ),
    )

    assert response.status_code == HTTPStatus.CREATED
    entry = await EntryCRUD.get_by_id(test_db, response.json()["entity_id"])
    assert entry is not None
    assert entry.city is None
    assert entry.region == "Southern Nevada"
    assert entry.latitude is None
    assert entry.longitude is None
    approved = await test_client.post(
        f"/api/review-queue/{response.json()['review_item_id']}/approve"
    )
    assert approved.status_code == HTTPStatus.OK
    regional_results = await test_client.get(
        "/api/entities?region=Southern%20Nevada&issue_area=transportation_and_mobility"
    )
    assert [item["id"] for item in regional_results.json()["items"]] == [entry.id]


@pytest.mark.asyncio
async def test_editor_can_stage_existing_profile_correction_without_changing_public_facts(
    test_client: httpx.AsyncClient,
    test_db: object,
) -> None:
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Las Vegans for Better Transit",
        description="Old generic description.",
        city=None,
        state="NV",
        geo_specificity="statewide",
        active=True,
        website="https://lasvegasfortransit.org/",
    )
    about_url = "https://lasvegasfortransit.org/about/"
    source_id = await SourceCRUD.create(
        test_db,
        url=about_url,
        source_type="org_website",
        extraction_method="manual",
    )
    await SourceCRUD.link_to_entry(test_db, entry_id, source_id)
    await SourceCRUD.create(
        test_db,
        url="https://lasvegasfortransit.org/join/",
        source_type="org_website",
        extraction_method="manual",
    )
    await test_db.execute(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) VALUES (?, ?, ?)",
        (entry_id, "housing_affordability", "2026-09-27T00:00:00Z"),
    )
    await test_db.commit()
    request = candidate(
        source_url="https://lasvegasfortransit.org/issues/transit/",
        action_url="https://lasvegasfortransit.org/join/",
    )

    staged = await test_client.post(
        f"/api/review-queue/editorial-profiles/{entry_id}/changes", json=request
    )

    assert staged.status_code == HTTPStatus.ACCEPTED
    assert staged.headers["cache-control"] == "no-store"
    assert staged.json()["status"] == "pending"
    before = await test_client.get(f"/api/entities/{entry_id}")
    assert before.json()["description"] == "Old generic description."
    assert before.json()["contact"]["website"] == "https://lasvegasfortransit.org/"
    assert before.json()["action_url"] is None
    assert before.json()["address"]["city"] is None
    assert before.json()["issue_area_ids"] == ["housing_affordability"]
    assert [source["url"] for source in before.json()["sources"]] == [about_url]
    queue = await test_client.get("/api/review-queue")
    review = queue.json()["items"][0]
    assert review["entity_id"] == entry_id
    assert review["proposed_changes"]["city"] == {"before": None, "after": "Las Vegas"}
    assert review["source_evidence"][0]["url"] == request["source_url"]

    approved = await test_client.post(
        f"/api/review-queue/{staged.json()['review_item_id']}/approve"
    )
    assert approved.status_code == HTTPStatus.OK
    after = await test_client.get(f"/api/entities/{entry_id}")
    assert after.json()["description"] == request["description"]
    assert after.json()["contact"]["website"] == "https://lasvegasfortransit.org/"
    assert after.json()["action_url"] == request["action_url"]
    assert after.json()["address"]["city"] == "Las Vegas"
    assert after.json()["issue_area_ids"] == request["issue_areas"]
    assert sorted(source["url"] for source in after.json()["sources"]) == sorted(
        [about_url, request["source_url"], request["action_url"]]
    )


@pytest.mark.asyncio
async def test_editorial_profile_change_rejects_unrelated_source_site(
    test_client: httpx.AsyncClient,
    test_db: object,
) -> None:
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Las Vegans for Better Transit",
        description="Old generic description.",
        city=None,
        state="NV",
        geo_specificity="statewide",
        active=True,
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://lasvegasfortransit.org/about/",
        source_type="org_website",
        extraction_method="manual",
    )
    await SourceCRUD.link_to_entry(test_db, entry_id, source_id)

    staged = await test_client.post(
        f"/api/review-queue/editorial-profiles/{entry_id}/changes",
        json=candidate(
            source_url="https://unrelated.example/about",
            action_url="https://unrelated.example/join",
        ),
    )

    assert staged.status_code == HTTPStatus.CONFLICT
    assert (await test_client.get("/api/review-queue")).json()["total"] == 0


@pytest.mark.asyncio
async def test_editorial_profile_change_rejects_stale_facts_without_linking_new_source(
    test_client: httpx.AsyncClient,
    test_db: object,
) -> None:
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Las Vegans for Better Transit",
        description="Old generic description.",
        city=None,
        state="NV",
        geo_specificity="statewide",
        active=True,
    )
    source_id = await SourceCRUD.create(
        test_db,
        url="https://lasvegasfortransit.org/about/",
        source_type="org_website",
        extraction_method="manual",
    )
    await SourceCRUD.link_to_entry(test_db, entry_id, source_id)
    staged = await test_client.post(
        f"/api/review-queue/editorial-profiles/{entry_id}/changes",
        json=candidate(),
    )
    assert staged.status_code == HTTPStatus.ACCEPTED
    await EntryCRUD.update(test_db, entry_id, description="Already corrected elsewhere.")

    approved = await test_client.post(
        f"/api/review-queue/{staged.json()['review_item_id']}/approve"
    )

    assert approved.status_code == HTTPStatus.CONFLICT
    public = await test_client.get(f"/api/entities/{entry_id}")
    assert public.json()["description"] == "Already corrected elsewhere."
    assert [source["url"] for source in public.json()["sources"]] == [
        "https://lasvegasfortransit.org/about/"
    ]
    assert (await test_client.get("/api/review-queue")).json()["total"] == 1


@pytest.mark.asyncio
async def test_editorial_profile_change_requires_a_real_change_and_one_pending_review(
    test_client: httpx.AsyncClient,
    test_db: object,
) -> None:
    missing = await test_client.post(
        f"/api/review-queue/editorial-profiles/{uuid4()}/changes", json=candidate()
    )
    assert missing.status_code == HTTPStatus.CONFLICT

    facts = candidate()
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name=str(facts["name"]),
        description=str(facts["description"]),
        city=str(facts["city"]),
        state=str(facts["state"]),
        region=str(facts["region"]),
        geo_specificity=str(facts["geo_specificity"]),
        website=str(facts["source_url"]),
        active=True,
    )
    await EntryCRUD.update(test_db, entry_id, action_url=str(facts["action_url"]))
    source_id = await SourceCRUD.create(
        test_db,
        url=str(facts["source_url"]),
        source_type="org_website",
        extraction_method="manual",
    )
    await SourceCRUD.link_to_entry(test_db, entry_id, source_id)
    for issue in facts["issue_areas"]:
        await test_db.execute(
            "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) VALUES (?, ?, ?)",
            (entry_id, issue, "2026-09-27T00:00:00Z"),
        )
    await test_db.commit()

    unchanged = await test_client.post(
        f"/api/review-queue/editorial-profiles/{entry_id}/changes", json=facts
    )
    assert unchanged.status_code == HTTPStatus.CONFLICT
    assert "No public profile facts changed" in unchanged.json()["detail"]

    changed = candidate(description="A corrected summary for this transit organization.")
    staged = await test_client.post(
        f"/api/review-queue/editorial-profiles/{entry_id}/changes", json=changed
    )
    repeated = await test_client.post(
        f"/api/review-queue/editorial-profiles/{entry_id}/changes", json=changed
    )
    assert staged.status_code == HTTPStatus.ACCEPTED
    assert repeated.status_code == HTTPStatus.CONFLICT

    rejected = await test_client.post(f"/api/review-queue/{staged.json()['review_item_id']}/reject")
    assert rejected.status_code == HTTPStatus.OK
    public = await test_client.get(f"/api/entities/{entry_id}")
    assert public.json()["description"] == facts["description"]
    assert [source["url"] for source in public.json()["sources"]] == [facts["source_url"]]

    before_issue_correction = await EntryCRUD.get_by_id(test_db, entry_id)
    assert before_issue_correction is not None
    issue_only = await test_client.post(
        f"/api/review-queue/editorial-profiles/{entry_id}/changes",
        json=candidate(issue_areas=["public_transit"]),
    )
    assert issue_only.status_code == HTTPStatus.ACCEPTED
    approved = await test_client.post(
        f"/api/review-queue/{issue_only.json()['review_item_id']}/approve"
    )
    assert approved.status_code == HTTPStatus.OK
    after_issue_correction = await EntryCRUD.get_by_id(test_db, entry_id)
    assert after_issue_correction is not None
    assert after_issue_correction.updated_at != before_issue_correction.updated_at
    assert (await EntryCRUD.get_issue_areas(test_db, entry_id)) == ["public_transit"]


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
    ("sql", "value"),
    [
        ("UPDATE entries SET name = ? WHERE id = ?", "Different Valley Transit Group"),
        (
            "UPDATE entries SET description = ? WHERE id = ?",
            "Unreviewed new description of the organization's work.",
        ),
        ("UPDATE entries SET city = ? WHERE id = ?", "Henderson"),
        ("UPDATE entries SET region = ? WHERE id = ?", "Clark County"),
        ("UPDATE entries SET geo_specificity = ? WHERE id = ?", "statewide"),
        (
            "UPDATE entries SET website = ? WHERE id = ?",
            "https://lasvegasfortransit.org/join/",
        ),
        (
            "UPDATE entries SET action_url = ? WHERE id = ?",
            "https://lasvegasfortransit.org/donate/",
        ),
        (
            "UPDATE entry_issue_areas SET issue_area = ? WHERE entry_id = ? AND issue_area = 'public_transit'",
            "housing_affordability",
        ),
    ],
)
async def test_editorial_candidate_cannot_publish_changed_facts(
    test_client: httpx.AsyncClient,
    test_db: object,
    sql: str,
    value: str,
) -> None:
    """Approval must not publish different identity, work, place, action, or issue facts."""
    staged = await test_client.post("/api/review-queue/editorial-candidates", json=candidate())
    entity_id = staged.json()["entity_id"]
    await test_db.execute(sql, (value, entity_id))
    await test_db.commit()

    approval = await test_client.post(
        f"/api/review-queue/{staged.json()['review_item_id']}/approve"
    )
    assert approval.status_code == HTTPStatus.CONFLICT
    entry = await EntryCRUD.get_by_id(test_db, entity_id)
    assert entry is not None
    assert not entry.active


@pytest.mark.asyncio
async def test_editorial_candidate_cannot_publish_a_changed_source_note(
    test_client: httpx.AsyncClient,
    test_db: object,
) -> None:
    """A changed citation note cannot silently support the queued description."""
    staged = await test_client.post("/api/review-queue/editorial-candidates", json=candidate())
    entity_id = staged.json()["entity_id"]
    await test_db.execute(
        """UPDATE entry_sources SET extraction_context = ? WHERE entry_id = ?
           AND source_id = (SELECT id FROM sources WHERE url = ?)""",
        (
            "This page says something else about a different transit group.",
            entity_id,
            candidate()["source_url"],
        ),
    )
    await test_db.commit()

    approval = await test_client.post(
        f"/api/review-queue/{staged.json()['review_item_id']}/approve"
    )
    assert approval.status_code == HTTPStatus.CONFLICT
    entry = await EntryCRUD.get_by_id(test_db, entity_id)
    assert entry is not None
    assert not entry.active


@pytest.mark.asyncio
@pytest.mark.parametrize("replacement", [None, "{}"])
async def test_editorial_candidate_without_queued_facts_needs_restaging(
    test_client: httpx.AsyncClient,
    test_db: object,
    replacement: str | None,
) -> None:
    """A pre-snapshot hold or stripped snapshot cannot bypass factual review."""
    staged = await test_client.post("/api/review-queue/editorial-candidates", json=candidate())
    await test_db.execute(
        "UPDATE review_queue SET proposed_changes = ? WHERE id = ?",
        (replacement, staged.json()["review_item_id"]),
    )
    await test_db.commit()

    approval = await test_client.post(
        f"/api/review-queue/{staged.json()['review_item_id']}/approve"
    )
    assert approval.status_code == HTTPStatus.CONFLICT
    entry = await EntryCRUD.get_by_id(test_db, staged.json()["entity_id"])
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
        {"city": None, "region": None, "geo_specificity": "regional"},
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
    correction = await test_client.post(
        f"/api/review-queue/editorial-profiles/{uuid4()}/changes",
        json=candidate(),
        headers=ordinary_headers,
    )
    assert correction.status_code == HTTPStatus.FORBIDDEN
