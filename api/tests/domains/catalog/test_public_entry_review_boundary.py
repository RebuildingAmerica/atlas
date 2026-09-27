"""Published workspace facts stay stable until an editor reviews an owner change."""

from __future__ import annotations

from http import HTTPStatus

import pytest

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.moderation.review_queue import ReviewConflictError, ReviewQueueCRUD
from atlas.models import EntryCRUD, SourceCRUD


async def _published_entry(db: object) -> tuple[str, str]:
    entry_id = await EntryCRUD.create(
        db,
        entry_type="organization",
        name="Las Vegas Transit Neighbors",
        description="Organizes local transit riders.",
        city="Las Vegas",
        state="NV",
        geo_specificity="local",
        website="https://transit.example.org",
        latitude=36.1699,
        longitude=-115.1398,
        geocode_precision="city",
        geocode_source="gazetteer",
    )
    await OwnershipCRUD.create_ownership(
        db,
        resource_id=entry_id,
        resource_type="entry",
        org_id="local",
        visibility="public",
        created_by="local-user",
    )
    source_url = "https://transit.example.org/about"
    source_id = await SourceCRUD.create(
        db,
        url=source_url,
        source_type="org_website",
        extraction_method="manual",
        title="About Las Vegas Transit Neighbors",
    )
    await SourceCRUD.link_to_entry(db, entry_id, source_id, "Organization overview")
    return entry_id, source_url


@pytest.mark.asyncio
async def test_generic_owner_edit_stages_public_fact_until_review(
    test_client: object, test_db: object
) -> None:
    entry_id, source_url = await _published_entry(test_db)

    response = await test_client.patch(
        f"/api/entities/{entry_id}",
        json={"description": "Organizes riders across Clark County."},
    )

    assert response.status_code == HTTPStatus.ACCEPTED
    assert response.json()["status"] == "pending_review"
    assert response.json()["entity_id"] == entry_id
    assert response.json()["review_item_id"]
    entry = await EntryCRUD.get_by_id(test_db, entry_id)
    assert entry is not None
    assert entry.description == "Organizes local transit riders."
    pending = await ReviewQueueCRUD.list_pending(test_db)
    assert len(pending) == 1
    assert pending[0].id == response.json()["review_item_id"]
    assert pending[0].org_id == "local"
    assert pending[0].source_urls == [source_url]
    assert pending[0].proposed_changes == {
        "description": {
            "before": "Organizes local transit riders.",
            "after": "Organizes riders across Clark County.",
        }
    }

    await ReviewQueueCRUD.approve(test_db, pending[0].id, reviewed_by="editor")
    approved = await EntryCRUD.get_by_id(test_db, entry_id)
    assert approved is not None
    assert approved.description == "Organizes riders across Clark County."


@pytest.mark.asyncio
async def test_org_owner_edit_stages_public_location_and_contact(
    test_client: object, test_db: object
) -> None:
    entry_id, _ = await _published_entry(test_db)

    response = await test_client.put(
        f"/api/orgs/local/entries/{entry_id}",
        json={"address": {"city": "Henderson"}, "contact": {"phone": "702-555-0100"}},
    )

    assert response.status_code == HTTPStatus.ACCEPTED
    entry = await EntryCRUD.get_by_id(test_db, entry_id)
    assert entry is not None
    assert entry.city == "Las Vegas"
    assert entry.phone is None
    pending = await ReviewQueueCRUD.list_pending(test_db)
    assert pending[0].proposed_changes == {
        "city": {"before": "Las Vegas", "after": "Henderson"},
        "phone": {"before": None, "after": "702-555-0100"},
    }

    await ReviewQueueCRUD.approve(test_db, pending[0].id, reviewed_by="editor")
    approved = await EntryCRUD.get_by_id(test_db, entry_id)
    assert approved is not None
    assert approved.city == "Henderson"
    assert approved.phone == "702-555-0100"
    assert (approved.latitude, approved.longitude) != (36.1699, -115.1398)


@pytest.mark.asyncio
async def test_owner_proposal_cannot_be_approved_after_ownership_transfer(
    test_client: object, test_db: object
) -> None:
    entry_id, _ = await _published_entry(test_db)
    response = await test_client.patch(
        f"/api/entities/{entry_id}", json={"name": "Transit Neighbors of Las Vegas"}
    )
    assert response.status_code == HTTPStatus.ACCEPTED
    await test_db.execute(
        "UPDATE resource_ownership SET org_id = ? WHERE resource_id = ? AND resource_type = 'entry'",
        ("different-org", entry_id),
    )
    await test_db.commit()

    with pytest.raises(ReviewConflictError):
        await ReviewQueueCRUD.approve(
            test_db, response.json()["review_item_id"], reviewed_by="editor"
        )

    entry = await EntryCRUD.get_by_id(test_db, entry_id)
    assert entry is not None
    assert entry.name == "Las Vegas Transit Neighbors"


@pytest.mark.asyncio
async def test_public_fact_and_private_tracking_edit_are_not_partially_saved(
    test_client: object, test_db: object
) -> None:
    entry_id, _ = await _published_entry(test_db)

    response = await test_client.patch(
        f"/api/entities/{entry_id}",
        json={"description": "New public wording.", "editorial_notes": "Owner's draft note"},
    )

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    entry = await EntryCRUD.get_by_id(test_db, entry_id)
    assert entry is not None
    assert entry.description == "Organizes local transit riders."
    assert entry.editorial_notes is None
    assert await ReviewQueueCRUD.list_pending(test_db) == []


@pytest.mark.asyncio
async def test_unchanged_public_fact_does_not_create_a_review_item(
    test_client: object, test_db: object
) -> None:
    entry_id, _ = await _published_entry(test_db)

    response = await test_client.patch(
        f"/api/entities/{entry_id}", json={"description": "Organizes local transit riders."}
    )

    assert response.status_code == HTTPStatus.OK
    assert await ReviewQueueCRUD.list_pending(test_db) == []


@pytest.mark.asyncio
@pytest.mark.parametrize(("field", "value"), [("verified", True), ("active", False)])
async def test_owner_cannot_set_editorial_verification_or_publication_state(
    test_client: object, test_db: object, field: str, value: bool
) -> None:
    entry_id, _ = await _published_entry(test_db)

    response = await test_client.patch(f"/api/entities/{entry_id}", json={field: value})

    assert response.status_code == HTTPStatus.FORBIDDEN
    entry = await EntryCRUD.get_by_id(test_db, entry_id)
    assert entry is not None
    assert entry.verified is False
    assert entry.active is True


@pytest.mark.asyncio
async def test_private_owner_cannot_self_verify_through_workspace_update(
    test_client: object, test_db: object
) -> None:
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Private Transit Draft",
        description="A draft organization profile.",
        city="Las Vegas",
        state="NV",
        geo_specificity="local",
    )
    await OwnershipCRUD.create_ownership(
        test_db,
        resource_id=entry_id,
        resource_type="entry",
        org_id="local",
        visibility="private",
        created_by="local-user",
    )

    response = await test_client.put(f"/api/orgs/local/entries/{entry_id}", json={"verified": True})

    assert response.status_code == HTTPStatus.FORBIDDEN
    entry = await EntryCRUD.get_by_id(test_db, entry_id)
    assert entry is not None
    assert entry.verified is False


@pytest.mark.asyncio
async def test_second_public_edit_does_not_silently_replace_pending_proposal(
    test_client: object, test_db: object
) -> None:
    entry_id, _ = await _published_entry(test_db)
    first = await test_client.patch(
        f"/api/entities/{entry_id}", json={"name": "Transit Neighbors of Las Vegas"}
    )

    second = await test_client.patch(
        f"/api/entities/{entry_id}", json={"name": "Nevada Transit Neighbors"}
    )

    assert first.status_code == HTTPStatus.ACCEPTED
    assert second.status_code == HTTPStatus.CONFLICT
    pending = await ReviewQueueCRUD.list_pending(test_db)
    assert len(pending) == 1
    assert pending[0].proposed_changes == {
        "name": {
            "before": "Las Vegas Transit Neighbors",
            "after": "Transit Neighbors of Las Vegas",
        }
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/api/entities/{id}", "/api/orgs/local/entries/{id}"])
async def test_owner_cannot_delete_published_entry_without_review(
    test_client: object, test_db: object, path: str
) -> None:
    entry_id, _ = await _published_entry(test_db)

    response = await test_client.delete(path.format(id=entry_id))

    assert response.status_code == HTTPStatus.CONFLICT
    assert await EntryCRUD.get_by_id(test_db, entry_id) is not None
