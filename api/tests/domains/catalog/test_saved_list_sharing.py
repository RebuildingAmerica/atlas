"""A team can deliberately share research without exposing personal lists."""

from __future__ import annotations

from typing import TYPE_CHECKING

import aiosqlite
import httpx
import pytest
from fastapi import HTTPException, Response

from atlas.domains.access.api.lists import (
    add_item,
    get_list,
    list_my_lists,
    membership,
    require_list_actor,
    set_list_sharing,
)
from atlas.domains.access.capabilities import resolve_capabilities
from atlas.domains.access.models.saved_lists import SavedListCRUD
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.schemas.public import SavedListItemRequest, SavedListSharingRequest
from atlas.main import create_app
from atlas.models.database_migrations import _ensure_saved_list_columns
from atlas.platform.config import Settings, get_settings

if TYPE_CHECKING:
    from pathlib import Path


def _actor(user_id: str, org_id: str, *, team: bool = True) -> AuthenticatedActor:
    products = ["atlas_team"] if team else []
    return AuthenticatedActor(
        user_id=user_id,
        email=f"{user_id}@atlas.test",
        auth_type="oauth_jwt",
        org_id=org_id,
        workspace_type="team",
        active_products=products,
        resolved_capabilities=resolve_capabilities(products),
    )


@pytest.mark.asyncio
async def test_shared_list_is_visible_and_editable_only_to_paid_workspace_members(
    test_db: object, claimable_org: str
) -> None:
    owner = _actor("owner", "team-one")
    teammate = _actor("teammate", "team-one")
    outsider = _actor("outsider", "team-two")
    expired = _actor("expired", "team-one", team=False)
    private = await SavedListCRUD.create(test_db, user_id=owner.user_id, name="Private leads")
    shared = await SavedListCRUD.create(test_db, user_id=owner.user_id, name="Transit leads")

    assert [row.id for row in await list_my_lists(Response(), actor=teammate, db=test_db)] == []
    await set_list_sharing(
        shared.id, SavedListSharingRequest(shared=True), Response(), actor=owner, db=test_db
    )
    assert [row.id for row in await list_my_lists(Response(), actor=teammate, db=test_db)] == [
        shared.id
    ]
    assert (await get_list(shared.id, Response(), actor=teammate, db=test_db)).org_id == "team-one"
    await add_item(
        shared.id,
        SavedListItemRequest(entry_id=claimable_org, note="Ask about bus access"),
        Response(),
        actor=teammate,
        db=test_db,
    )
    assert (await get_list(shared.id, Response(), actor=owner, db=test_db)).items[0].note == (
        "Ask about bus access"
    )
    assert await membership(claimable_org, Response(), actor=teammate, db=test_db) == [shared.id]

    for blocked in (outsider, expired):
        assert await list_my_lists(Response(), actor=blocked, db=test_db) == []
        with pytest.raises(HTTPException) as exc:
            await get_list(shared.id, Response(), actor=blocked, db=test_db)
        assert exc.value.status_code == 404

    with pytest.raises(HTTPException) as exc:
        await get_list(private.id, Response(), actor=teammate, db=test_db)
    assert exc.value.status_code == 404

    await set_list_sharing(
        shared.id, SavedListSharingRequest(shared=False), Response(), actor=owner, db=test_db
    )
    assert await list_my_lists(Response(), actor=teammate, db=test_db) == []
    assert [row.id for row in await list_my_lists(Response(), actor=owner, db=test_db)] == [
        shared.id,
        private.id,
    ]


@pytest.mark.asyncio
async def test_existing_saved_lists_migrate_as_private(tmp_path: Path) -> None:
    database_path = tmp_path / "saved-lists.sqlite"
    async with aiosqlite.connect(database_path) as conn:
        await conn.execute(
            "CREATE TABLE saved_lists (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT)"
        )
        await conn.execute(
            "INSERT INTO saved_lists (id, user_id, name) VALUES ('old', 'owner', 'Old list')"
        )
        await _ensure_saved_list_columns(conn)
        await _ensure_saved_list_columns(conn)
        cursor = await conn.execute("SELECT id, org_id FROM saved_lists")
        assert await cursor.fetchall() == [("old", None)]


@pytest.mark.asyncio
async def test_only_owner_with_team_access_can_change_sharing(test_db: object) -> None:
    owner = _actor("owner", "team-one")
    teammate = _actor("teammate", "team-one")
    unpaid_owner = _actor("owner", "team-one", team=False)
    other_workspace_owner = _actor("owner", "team-two")
    saved_list = await SavedListCRUD.create(test_db, user_id=owner.user_id, name="Leads")

    for blocked in (teammate, unpaid_owner):
        with pytest.raises(HTTPException):
            await set_list_sharing(
                saved_list.id,
                SavedListSharingRequest(shared=True),
                Response(),
                actor=blocked,
                db=test_db,
            )
    assert (await SavedListCRUD.get_by_id(test_db, saved_list.id)).org_id is None
    await set_list_sharing(
        saved_list.id,
        SavedListSharingRequest(shared=True),
        Response(),
        actor=owner,
        db=test_db,
    )
    with pytest.raises(HTTPException) as exc:
        await set_list_sharing(
            saved_list.id,
            SavedListSharingRequest(shared=False),
            Response(),
            actor=other_workspace_owner,
            db=test_db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_revoked_workspace_membership_cannot_open_shared_lists(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    test_settings.auth_membership_verification_url = "https://auth.example.test/memberships"

    async def revoked_membership(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(
        "atlas.domains.access.dependencies.verify_org_membership", revoked_membership
    )
    with pytest.raises(HTTPException) as exc:
        await require_list_actor(actor=_actor("former-member", "team-one"), settings=test_settings)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_personal_list_actor_needs_no_workspace_membership(test_settings: Settings) -> None:
    actor = AuthenticatedActor(
        user_id="individual",
        email="individual@atlas.test",
        auth_type="oauth_jwt",
    )
    assert await require_list_actor(actor=actor, settings=test_settings) is actor


@pytest.mark.asyncio
async def test_share_reports_list_removed_during_visibility_change(
    test_db: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = _actor("owner", "team-one")
    saved_list = await SavedListCRUD.create(test_db, user_id=owner.user_id, name="Transit leads")

    async def remove_before_change(
        conn: aiosqlite.Connection, list_id: str, _org_id: str | None
    ) -> None:
        await SavedListCRUD.delete(conn, list_id)

    monkeypatch.setattr(SavedListCRUD, "set_sharing", remove_before_change)
    with pytest.raises(HTTPException) as exc:
        await set_list_sharing(
            saved_list.id,
            SavedListSharingRequest(shared=True),
            Response(),
            actor=owner,
            db=test_db,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_http_team_share_then_teammate_adds_sourced_lead(
    test_settings: Settings, claimable_org: str
) -> None:
    active_actor = _actor("owner", "team-one")
    app = create_app()

    def override_settings() -> Settings:
        return test_settings

    async def override_actor() -> AuthenticatedActor:
        return active_actor

    app.dependency_overrides[get_settings] = override_settings
    app.dependency_overrides[require_list_actor] = override_actor
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post("/api/lists", json={"name": "Las Vegas transit leads"})
        assert created.status_code == 201
        list_id = created.json()["id"]
        assert created.json()["org_id"] is None
        shared = await client.patch(f"/api/lists/{list_id}/sharing", json={"shared": True})
        assert shared.status_code == 200
        assert shared.json()["org_id"] == "team-one"

        active_actor = _actor("teammate", "team-one")
        assert [item["id"] for item in (await client.get("/api/lists")).json()] == [list_id]
        added = await client.post(
            f"/api/lists/{list_id}/items",
            json={"entry_id": claimable_org, "note": "Contact about route access"},
        )
        assert added.status_code == 201
        assert (await client.get(f"/api/lists/{list_id}")).json()["items"][0]["note"] == (
            "Contact about route access"
        )

        active_actor = _actor("outsider", "team-two")
        assert (await client.get(f"/api/lists/{list_id}")).status_code == 404
