"""What a saved list costs, and who is allowed one."""

# ruff: noqa: PLR2004

from __future__ import annotations

import pytest
from fastapi import HTTPException, Response

from atlas.domains.access.capabilities import resolve_capabilities
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.schemas.public import SavedListCreateRequest, SavedListItemRequest
from atlas.models import EntryCRUD


def _actor(*, products: list[str] | None = None) -> AuthenticatedActor:
    active_products = products or []
    actor = AuthenticatedActor(
        user_id="plan-test-user",
        email="plan-test@atlas.example",
        auth_type="oauth_jwt",
    )
    actor.active_products = active_products
    actor.resolved_capabilities = resolve_capabilities(active_products)
    return actor


class TestSavedListEntitlements:
    """Plan gates for saved-list features advertised on pricing."""

    @pytest.mark.asyncio
    async def test_free_actor_cannot_create_second_saved_list(self, test_db: object) -> None:
        from atlas.domains.access.api.lists import create_list

        actor = _actor()
        payload = SavedListCreateRequest(name="Free list", description=None)
        await create_list(payload, Response(), actor=actor, db=test_db)

        with pytest.raises(HTTPException) as excinfo:
            await create_list(
                SavedListCreateRequest(name="Second list", description=None),
                Response(),
                actor=actor,
                db=test_db,
            )

        assert excinfo.value.status_code == 403
        assert excinfo.value.detail["limit"] == "max_shortlists"

    @pytest.mark.asyncio
    async def test_free_actor_cannot_add_notes(self, test_db: object, claimable_org: str) -> None:
        from atlas.domains.access.api.lists import add_item, create_list

        actor = _actor()
        created = await create_list(
            SavedListCreateRequest(name="Free list", description=None),
            Response(),
            actor=actor,
            db=test_db,
        )

        with pytest.raises(HTTPException) as excinfo:
            await add_item(
                created.id,
                SavedListItemRequest(entry_id=claimable_org, note="follow up"),
                Response(),
                actor=actor,
                db=test_db,
            )

        assert excinfo.value.status_code == 403
        assert excinfo.value.detail["capability"] == "workspace.notes"

    @pytest.mark.asyncio
    async def test_free_actor_cannot_export_saved_lists(
        self, test_db: object, claimable_org: str
    ) -> None:
        from atlas.domains.access.api.lists import add_item, create_list, export_list

        actor = _actor()
        created = await create_list(
            SavedListCreateRequest(name="Free list", description=None),
            Response(),
            actor=actor,
            db=test_db,
        )
        await add_item(
            created.id,
            SavedListItemRequest(entry_id=claimable_org, note=None),
            Response(),
            actor=actor,
            db=test_db,
        )

        with pytest.raises(HTTPException) as excinfo:
            await export_list(created.id, Response(), actor=actor, db=test_db)

        assert excinfo.value.status_code == 403
        assert excinfo.value.detail["capability"] == "workspace.export"

    @pytest.mark.asyncio
    async def test_free_actor_cannot_exceed_entry_limit(
        self, test_db: object, claimable_org: str
    ) -> None:
        from atlas.domains.access.api.lists import add_item, create_list

        actor = _actor()
        created = await create_list(
            SavedListCreateRequest(name="Free list", description=None),
            Response(),
            actor=actor,
            db=test_db,
        )
        await add_item(
            created.id,
            SavedListItemRequest(entry_id=claimable_org, note=None),
            Response(),
            actor=actor,
            db=test_db,
        )
        for index in range(24):
            entry_id = await EntryCRUD.create(
                test_db,
                entry_type="organization",
                name=f"Limit Test Org {index}",
                description="Limit test organization.",
                city="Kansas City",
                state="MO",
                geo_specificity="local",
            )
            await add_item(
                created.id,
                SavedListItemRequest(entry_id=entry_id, note=None),
                Response(),
                actor=actor,
                db=test_db,
            )

        overflow_entry_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Limit Test Org Overflow",
            description="Overflow organization.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )
        with pytest.raises(HTTPException) as excinfo:
            await add_item(
                created.id,
                SavedListItemRequest(entry_id=overflow_entry_id, note=None),
                Response(),
                actor=actor,
                db=test_db,
            )

        assert excinfo.value.status_code == 403
        assert excinfo.value.detail["limit"] == "max_shortlist_entries"

    @pytest.mark.asyncio
    async def test_free_actor_can_re_save_an_entry_already_at_the_limit(
        self, test_db: object, claimable_org: str
    ) -> None:
        """Re-adding an entry already in the list is not a new item, so it can't overflow."""
        from atlas.domains.access.api.lists import add_item, create_list

        actor = _actor()
        created = await create_list(
            SavedListCreateRequest(name="Free list", description=None),
            Response(),
            actor=actor,
            db=test_db,
        )
        await add_item(
            created.id,
            SavedListItemRequest(entry_id=claimable_org, note=None),
            Response(),
            actor=actor,
            db=test_db,
        )
        for index in range(24):
            entry_id = await EntryCRUD.create(
                test_db,
                entry_type="organization",
                name=f"Resave Limit Test Org {index}",
                description="Limit test organization.",
                city="Kansas City",
                state="MO",
                geo_specificity="local",
            )
            await add_item(
                created.id,
                SavedListItemRequest(entry_id=entry_id, note=None),
                Response(),
                actor=actor,
                db=test_db,
            )

        item = await add_item(
            created.id,
            SavedListItemRequest(entry_id=claimable_org, note=None),
            Response(),
            actor=actor,
            db=test_db,
        )

        assert item.entry_id == claimable_org

    @pytest.mark.asyncio
    async def test_research_pass_gets_team_level_list_access(
        self, test_db: object, claimable_org: str
    ) -> None:
        from atlas.domains.access.api.lists import add_item, create_list, export_list

        actor = _actor(products=["atlas_research_pass"])
        first = await create_list(
            SavedListCreateRequest(name="Pass list", description=None),
            Response(),
            actor=actor,
            db=test_db,
        )
        second = await create_list(
            SavedListCreateRequest(name="Second pass list", description=None),
            Response(),
            actor=actor,
            db=test_db,
        )

        item = await add_item(
            second.id,
            SavedListItemRequest(entry_id=claimable_org, note="follow up"),
            Response(),
            actor=actor,
            db=test_db,
        )
        exported = await export_list(first.id, Response(), actor=actor, db=test_db)

        assert item.note == "follow up"
        assert exported.list_.id == first.id
