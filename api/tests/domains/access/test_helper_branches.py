"""Tests for access helper branches."""
# ruff: noqa

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, Response
from starlette.routing import Route

from atlas.config import Settings
from atlas.domains.access import capabilities as access_capabilities
from atlas.domains.access import dependencies as access_dependencies
from atlas.domains.access.api import lists as lists_api
from atlas.domains.access.api import org_usage as org_usage_api
from atlas.domains.access.api import org_watches as org_watches_api
from atlas.domains.access.models.saved_lists import SavedListModel
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.access.models.watch_events import (
    OrgChangeEventCRUD,
    OrgChangeEventRecord,
    OrgCoverageStatusChange,
)
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.schemas.public import SavedListItemRequest
from atlas.models import EntryCRUD, SourceCRUD


def _closure_function(function: object, name: str) -> object:
    """Return the named closure function from a returned dependency."""
    closure = getattr(function, "__closure__", None)
    if closure is None:
        raise AssertionError("dependency has no closure")
    for cell in closure:
        value = cell.cell_contents
        if getattr(value, "__name__", None) == name:
            return value
    raise AssertionError(f"missing closure function: {name}")


class TestDependencies:
    """Request-usage accounting helpers."""

    @pytest.mark.asyncio
    async def test_route_usage_resource_id_and_duplicate_guard(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Route templates should be preferred, then the raw URL path, then the repeat guard."""
        record_mock = AsyncMock()
        monkeypatch.setattr(access_dependencies.OrgUsageEventCRUD, "record", record_mock)

        actor = AuthenticatedActor(
            user_id="user-1",
            email="operator@example.com",
            auth_type="api_key",
            org_id="org-1",
        )

        routed_request = SimpleNamespace(
            method="GET",
            scope={"route": Route("/api/entities/{entity_id}", lambda request: None)},
            url=SimpleNamespace(path="/api/entities/entry-1"),
            state=SimpleNamespace(),
        )
        await access_dependencies._record_external_api_call_usage(
            AsyncMock(),
            request=routed_request,
            actor=actor,
        )

        fallback_request = SimpleNamespace(
            method="GET",
            scope={"route": object()},
            url=SimpleNamespace(path="/api/fallback"),
            state=SimpleNamespace(),
        )
        await access_dependencies._record_external_api_call_usage(
            AsyncMock(),
            request=fallback_request,
            actor=actor,
        )

        repeated_request = SimpleNamespace(
            method="GET",
            scope={"route": object()},
            url=SimpleNamespace(path="/api/repeated"),
            state=SimpleNamespace(_atlas_api_usage_recorded=True),
        )
        await access_dependencies._record_external_api_call_usage(
            AsyncMock(),
            request=repeated_request,
            actor=actor,
        )

        assert record_mock.await_count == 2
        assert record_mock.await_args_list[0].args[1].resource_id == "/api/entities/{entity_id}"
        assert record_mock.await_args_list[1].args[1].resource_id == "/api/fallback"

    def test_route_usage_resource_id_falls_back_to_url_path(self) -> None:
        """Non-route scopes should use the raw request path."""
        request = SimpleNamespace(scope={"route": object()}, url=SimpleNamespace(path="/api/raw"))

        assert access_dependencies._route_usage_resource_id(request) == "/api/raw"


class TestCapabilities:
    """Capability limit helpers."""

    @pytest.mark.asyncio
    async def test_enforce_limit_uses_public_actor_capabilities(self) -> None:
        """Public actors should pass through the inner capability helper unchanged."""
        dependency = access_capabilities.enforce_limit("max_api_keys")
        capability_actor = dependency.__defaults__[0].dependency
        public_actor = AuthenticatedActor(
            user_id="user-2",
            email="reader@example.com",
            auth_type="oauth_jwt",
        )
        settings = Settings(database_url="sqlite:///tmp/test.db")

        returned_actor = await capability_actor(actor=public_actor, settings=settings)
        limit = await dependency(actor=public_actor)

        assert returned_actor is public_actor
        assert limit == 0


class TestSavedLists:
    """Saved-list helper branches."""

    def test_entry_location_uses_display_city_and_state(self) -> None:
        """Export rows should use the most honest available location string."""
        assert lists_api._entry_location(None) == ""
        assert (
            lists_api._entry_location(
                SimpleNamespace(
                    address=SimpleNamespace(display="Downtown", city="Kansas City", state="MO")
                )
            )
            == "Downtown"
        )
        assert (
            lists_api._entry_location(
                SimpleNamespace(address=SimpleNamespace(display="", city="Kansas City", state="MO"))
            )
            == "Kansas City, MO"
        )

    @pytest.mark.asyncio
    async def test_export_list_rejects_missing_list(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Missing saved lists should return a 404 before export work starts."""
        actor = AuthenticatedActor(
            user_id="user-1",
            email="operator@example.com",
            auth_type="oauth_jwt",
            org_id=None,
        )
        response = Response()
        monkeypatch.setattr(lists_api.SavedListCRUD, "get_by_id", AsyncMock(return_value=None))

        with pytest.raises(HTTPException, match="List not found"):
            await lists_api.export_list(
                "missing-list",
                response=response,
                export_format="json",
                actor=actor,
                db=AsyncMock(),
            )

    @pytest.mark.asyncio
    async def test_add_item_records_workspace_usage_on_first_save(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The first saved list item should emit a workspace usage event."""
        actor = AuthenticatedActor(
            user_id="user-1",
            email="operator@example.com",
            auth_type="oauth_jwt",
            org_id="org-1",
        )
        saved_list = SavedListModel(
            id="list-1",
            user_id="user-1",
            name="Neighborhood Leads",
            description=None,
            created_at="2026-07-05T00:00:00Z",
            updated_at="2026-07-05T00:00:00Z",
        )
        item = SimpleNamespace(
            list_id="list-1",
            entry_id="entry-1",
            note="call soon",
            added_at="2026-07-05T00:00:00Z",
        )
        record_mock = AsyncMock()

        monkeypatch.setattr(
            lists_api.SavedListCRUD, "get_by_id", AsyncMock(return_value=saved_list)
        )
        monkeypatch.setattr(
            lists_api.EntryCRUD, "get_by_id", AsyncMock(return_value=SimpleNamespace(id="entry-1"))
        )
        monkeypatch.setattr(lists_api.SavedListCRUD, "add_item", AsyncMock(return_value=item))
        monkeypatch.setattr(lists_api.OrgUsageEventCRUD, "record", record_mock)
        monkeypatch.setattr(lists_api, "_hydrate_entry", AsyncMock(return_value=None))

        response = await lists_api.add_item(
            "list-1",
            SavedListItemRequest(entry_id="entry-1", note="call soon"),
            response=Response(),
            actor=actor,
            db=AsyncMock(),
        )

        assert response.entry is None
        assert record_mock.await_count == 1
        assert record_mock.await_args.args[1].event_type == "list_item_saved"

    @pytest.mark.asyncio
    async def test_add_item_skips_workspace_usage_without_org(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Personal saved lists should not emit workspace usage rows."""
        actor = AuthenticatedActor(
            user_id="user-1",
            email="operator@example.com",
            auth_type="oauth_jwt",
        )
        saved_list = SavedListModel(
            id="list-1",
            user_id="user-1",
            name="Neighborhood Leads",
            description=None,
            created_at="2026-07-05T00:00:00Z",
            updated_at="2026-07-05T00:00:00Z",
        )
        item = SimpleNamespace(
            list_id="list-1",
            entry_id="entry-1",
            note=None,
            added_at="2026-07-05T00:00:00Z",
        )
        record_mock = AsyncMock()

        monkeypatch.setattr(
            lists_api.SavedListCRUD, "get_by_id", AsyncMock(return_value=saved_list)
        )
        monkeypatch.setattr(
            lists_api.EntryCRUD, "get_by_id", AsyncMock(return_value=SimpleNamespace(id="entry-1"))
        )
        monkeypatch.setattr(lists_api.SavedListCRUD, "add_item", AsyncMock(return_value=item))
        monkeypatch.setattr(lists_api.OrgUsageEventCRUD, "record", record_mock)
        monkeypatch.setattr(lists_api, "_hydrate_entry", AsyncMock(return_value=None))

        response = await lists_api.add_item(
            "list-1",
            SavedListItemRequest(entry_id="entry-1", note=None),
            response=Response(),
            actor=actor,
            db=AsyncMock(),
        )

        assert response.entry is None
        assert record_mock.await_count == 0


class TestOrgUsage:
    """Renewal packet helper branches."""

    def test_empty_renewal_packet_mentions_no_events(self) -> None:
        """A blank renewal packet should still render a plain-language message."""
        packet = org_usage_api._renewal_packet_response(org_id="org-1", event_counts={})

        assert packet.highlights == ["No renewal events yet."]
        assert "- No renewal events yet." in org_usage_api._renewal_packet_markdown(packet)


class TestOrgWatches:
    """Workspace watch helper branches."""

    @pytest.mark.asyncio
    async def test_verify_watchable_resource_rejects_missing_entry(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Entry watches should 404 when the target entry is missing."""
        monkeypatch.setattr(org_watches_api.EntryCRUD, "get_by_id", AsyncMock(return_value=None))

        with pytest.raises(HTTPException, match="Watch target not found"):
            await org_watches_api._verify_watchable_resource(
                AsyncMock(),
                org_id="org-1",
                resource_type="entry",
                resource_id="missing-entry",
            )

    @pytest.mark.asyncio
    async def test_watch_org_resource_records_usage_on_first_watch(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The first watch on a resource should emit a usage signal."""
        actor = AuthenticatedActor(
            user_id="user-1",
            email="operator@example.com",
            auth_type="oauth_jwt",
            org_id="org-1",
        )
        context = SimpleNamespace(response=Response(), actor=actor, db=AsyncMock())
        watch = SimpleNamespace(
            id="watch-1",
            org_id="org-1",
            resource_type="entry",
            resource_id="entry-1",
            notification_preference="digest",
            created_by="user-1",
            created_at="2026-07-05T00:00:00Z",
            updated_at="2026-07-05T00:00:00Z",
        )
        record_mock = AsyncMock()

        monkeypatch.setattr(org_watches_api.OrgWatchCRUD, "get", AsyncMock(return_value=None))
        monkeypatch.setattr(org_watches_api.OrgWatchCRUD, "upsert", AsyncMock(return_value=watch))
        monkeypatch.setattr(org_watches_api.OrgUsageEventCRUD, "record", record_mock)
        monkeypatch.setattr(org_watches_api, "_verify_watchable_resource", AsyncMock())

        response = await org_watches_api.watch_org_resource(
            "org-1",
            "entry",
            "entry-1",
            None,
            context=context,
        )

        assert response.id == "watch-1"
        assert record_mock.await_count == 1
        assert record_mock.await_args.args[1].event_type == "watch_created"

    @pytest.mark.asyncio
    async def test_watch_org_resource_skips_usage_on_existing_watch(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Updating an existing watch should not double-count usage."""
        actor = AuthenticatedActor(
            user_id="user-1",
            email="operator@example.com",
            auth_type="oauth_jwt",
            org_id="org-1",
        )
        context = SimpleNamespace(response=Response(), actor=actor, db=AsyncMock())
        existing = SimpleNamespace(id="watch-1")
        watch = SimpleNamespace(
            id="watch-1",
            org_id="org-1",
            resource_type="entry",
            resource_id="entry-1",
            notification_preference="immediate",
            created_by="user-1",
            created_at="2026-07-05T00:00:00Z",
            updated_at="2026-07-05T00:00:00Z",
        )
        record_mock = AsyncMock()

        monkeypatch.setattr(org_watches_api.OrgWatchCRUD, "get", AsyncMock(return_value=existing))
        monkeypatch.setattr(org_watches_api.OrgWatchCRUD, "upsert", AsyncMock(return_value=watch))
        monkeypatch.setattr(org_watches_api.OrgUsageEventCRUD, "record", record_mock)
        monkeypatch.setattr(org_watches_api, "_verify_watchable_resource", AsyncMock())

        response = await org_watches_api.watch_org_resource(
            "org-1",
            "entry",
            "entry-1",
            None,
            context=context,
        )

        assert response.id == "watch-1"
        assert record_mock.await_count == 0

    @pytest.mark.asyncio
    async def test_unwatch_org_resource_returns_no_content(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Removing a watch should return a clean no-content response."""
        actor = AuthenticatedActor(
            user_id="user-1",
            email="operator@example.com",
            auth_type="oauth_jwt",
            org_id="org-1",
        )
        context = SimpleNamespace(response=Response(), actor=actor, db=AsyncMock())

        monkeypatch.setattr(org_watches_api.OrgWatchCRUD, "delete", AsyncMock())
        monkeypatch.setattr(org_watches_api, "_verify_watchable_resource", AsyncMock())

        response = await org_watches_api.unwatch_org_resource(
            "org-1",
            "entry",
            "entry-1",
            context=context,
        )

        assert response.status_code == 204  # noqa: PLR2004


class TestUsageEvents:
    """Workspace usage-event helper branches."""

    @pytest.mark.asyncio
    async def test_list_api_calls_by_org_filters_to_api_call_rows(self, test_db: object) -> None:
        """The integration list should exclude non-api events."""
        api_event = await OrgUsageEventCRUD.record(
            test_db,
            OrgUsageEventRecord(
                org_id="org-1",
                actor_id="user-1",
                event_type="api_call",
                resource_type="api",
                resource_id="/api/public-directories",
                metadata_json='{"surface":"api"}',
            ),
        )
        await OrgUsageEventCRUD.record(
            test_db,
            OrgUsageEventRecord(
                org_id="org-1",
                actor_id="user-1",
                event_type="brief_opened",
                resource_type="brief",
                resource_id="brief-1",
            ),
        )

        rows = await OrgUsageEventCRUD.list_api_calls_by_org(test_db, org_id="org-1")

        assert [row.id for row in rows] == [api_event.id]

    @pytest.mark.asyncio
    async def test_count_integration_calls_by_surface_tracks_latest_seen(
        self, test_db: object
    ) -> None:
        """API and MCP calls should be counted separately with the newest timestamp."""
        api_event = await OrgUsageEventCRUD.record(
            test_db,
            OrgUsageEventRecord(
                org_id="org-1",
                actor_id="user-1",
                event_type="api_call",
                resource_type="api",
                resource_id="/api/public-directories",
                metadata_json='{"surface":"api"}',
            ),
        )
        mcp_event = await OrgUsageEventCRUD.record(
            test_db,
            OrgUsageEventRecord(
                org_id="org-1",
                actor_id="user-1",
                event_type="api_call",
                resource_type="api",
                resource_id="/mcp",
                metadata_json='{"surface":"mcp"}',
            ),
        )
        await test_db.execute(
            "UPDATE org_usage_events SET created_at = ? WHERE id = ?",
            ("2026-07-05T11:00:00Z", api_event.id),
        )
        await test_db.execute(
            "UPDATE org_usage_events SET created_at = ? WHERE id = ?",
            ("2026-07-05T11:00:00Z", mcp_event.id),
        )
        await test_db.commit()

        counts = await OrgUsageEventCRUD.count_integration_calls_by_surface(test_db, org_id="org-1")

        assert counts.total_calls == 2
        assert counts.api_calls == 1
        assert counts.mcp_calls == 1
        assert counts.last_seen_at == "2026-07-05T11:00:00Z"


class TestWatchEvents:
    """Change-event helper branches."""

    @pytest.mark.asyncio
    async def test_record_reuses_existing_source_event(self, test_db: object) -> None:
        """A repeated source-backed change should reuse the existing row."""
        entry_id = await EntryCRUD.create(
            test_db,
            entry_type="organization",
            name="Neighborhood Legal Center",
            description="Profile for digest coverage.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )
        source_id = await SourceCRUD.create(
            test_db,
            url="https://example.test/new-source",
            source_type="news_article",
            extraction_method="manual",
            title="New source",
            publication="Example Civic News",
        )
        first = await OrgChangeEventCRUD.record(
            test_db,
            OrgChangeEventRecord(
                org_id="org-1",
                resource_type="entry",
                resource_id=entry_id,
                event_type="new_source",
                title="New source",
                summary="A new public source was linked.",
                source_id=source_id,
                entry_id=entry_id,
            ),
        )
        second = await OrgChangeEventCRUD.record(
            test_db,
            OrgChangeEventRecord(
                org_id="org-1",
                resource_type="entry",
                resource_id=entry_id,
                event_type="new_source",
                title="New source",
                summary="A new public source was linked.",
                source_id=source_id,
                entry_id=entry_id,
            ),
        )

        assert second.id == first.id

    @pytest.mark.asyncio
    async def test_record_entry_source_events_returns_empty_for_missing_entry(
        self, test_db: object
    ) -> None:
        """Missing watched entries should not create digest rows."""
        assert (
            await OrgChangeEventCRUD.record_entry_source_events(
                test_db,
                entry_id="missing-entry",
                source_id="source-1",
            )
            == []
        )

    @pytest.mark.asyncio
    async def test_record_coverage_status_event_skips_same_status_and_unwatched_targets(
        self, test_db: object
    ) -> None:
        """Unchanged or unwatched coverage updates should not emit events."""
        same_status = await OrgChangeEventCRUD.record_coverage_status_event(
            test_db,
            OrgCoverageStatusChange(
                org_id="org-1",
                target_id="target-1",
                target_name="Tenant Power",
                previous_status="covered",
                new_status="covered",
            ),
        )
        unwatched = await OrgChangeEventCRUD.record_coverage_status_event(
            test_db,
            OrgCoverageStatusChange(
                org_id="org-1",
                target_id="target-1",
                target_name="Tenant Power",
                previous_status="covered",
                new_status="growing",
            ),
        )

        assert same_status is None
        assert unwatched is None
