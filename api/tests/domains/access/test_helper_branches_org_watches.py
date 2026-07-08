"""Tests for access helper branches."""
# ruff: noqa

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, Response

from atlas.domains.access.api import org_usage as org_usage_api
from atlas.domains.access.api import org_watches as org_watches_api
from atlas.domains.access.principals import AuthenticatedActor


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
