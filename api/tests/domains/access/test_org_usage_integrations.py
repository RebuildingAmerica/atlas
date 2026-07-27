"""Tests for org-scoped renewal usage summaries."""

from __future__ import annotations

import pytest

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord

STATUS_OK = 200
ORG_ID = "local"
EXPECTED_INTEGRATION_EVENTS = 3
EXPECTED_API_INTEGRATION_EVENTS = 2
EXPECTED_MCP_INTEGRATION_EVENTS = 1
EXPECTED_ROLLUP_EVENTS = 25
EXPECTED_TOP_INTEGRATION_RESOURCES = 10


class TestOrgUsageIntegrations:
    """Integration summary behavior for workspace usage events."""

    @pytest.mark.asyncio
    async def test_integration_summary_splits_api_and_mcp_usage(
        self,
        usage_client: object,
        test_db: object,
    ) -> None:
        """Admins should see whether integrations are active through REST API or MCP."""
        api_event = await OrgUsageEventCRUD.record(
            test_db,
            OrgUsageEventRecord(
                org_id=ORG_ID,
                actor_id="api-user",
                event_type="api_call",
                resource_type="api",
                resource_id="/api/public-directories",
                metadata_json='{"auth_type":"api_key","method":"GET","surface":"api"}',
            ),
        )
        second_api_event = await OrgUsageEventCRUD.record(
            test_db,
            OrgUsageEventRecord(
                org_id=ORG_ID,
                actor_id="api-user",
                event_type="api_call",
                resource_type="api",
                resource_id="/api/public-directories",
                metadata_json='{"auth_type":"api_key","method":"GET","surface":"api"}',
            ),
        )
        mcp_event = await OrgUsageEventCRUD.record(
            test_db,
            OrgUsageEventRecord(
                org_id=ORG_ID,
                actor_id="mcp-user",
                event_type="api_call",
                resource_type="api",
                resource_id="/mcp",
                metadata_json='{"auth_type":"oauth_jwt","method":"POST","surface":"mcp"}',
            ),
        )
        await OrgUsageEventCRUD.record(
            test_db,
            OrgUsageEventRecord(
                org_id="other-org",
                actor_id="other-user",
                event_type="api_call",
                resource_type="api",
                resource_id="/mcp",
                metadata_json='{"surface":"mcp"}',
            ),
        )
        await test_db.execute(
            "UPDATE org_usage_events SET created_at = ? WHERE id = ?",
            ("2026-07-03T09:00:00+00:00", api_event.id),
        )
        await test_db.execute(
            "UPDATE org_usage_events SET created_at = ? WHERE id = ?",
            ("2026-07-03T10:00:00+00:00", second_api_event.id),
        )
        await test_db.execute(
            "UPDATE org_usage_events SET created_at = ? WHERE id = ?",
            ("2026-07-03T11:00:00+00:00", mcp_event.id),
        )
        await test_db.commit()

        response = await usage_client.get(f"/api/orgs/{ORG_ID}/usage-summary/integrations")

        assert response.status_code == STATUS_OK
        body = response.json()
        assert body["org_id"] == ORG_ID
        assert body["total_calls"] == EXPECTED_INTEGRATION_EVENTS
        assert body["api_calls"] == EXPECTED_API_INTEGRATION_EVENTS
        assert body["mcp_calls"] == EXPECTED_MCP_INTEGRATION_EVENTS
        assert body["last_seen_at"] == "2026-07-03T11:00:00+00:00"
        assert body["top_resources"] == [
            {
                "resource_id": "/api/public-directories",
                "surface": "api",
                "total_calls": EXPECTED_API_INTEGRATION_EVENTS,
                "last_seen_at": "2026-07-03T10:00:00+00:00",
            },
            {
                "resource_id": "/mcp",
                "surface": "mcp",
                "total_calls": EXPECTED_MCP_INTEGRATION_EVENTS,
                "last_seen_at": "2026-07-03T11:00:00+00:00",
            },
        ]
        assert body["data_boundary"] == {
            "request_metadata_included": False,
            "session_replay_included": False,
            "statement": (
                "Workspace integration activity records counts, surfaces, paths, and "
                "last-seen times without request metadata or behavioral session replay."
            ),
        }

    @pytest.mark.asyncio
    async def test_integration_summary_uses_bounded_resource_rollup(
        self,
        usage_client: object,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Workspace integration activity should not load every raw API call into the route."""
        for index in range(EXPECTED_ROLLUP_EVENTS):
            await OrgUsageEventCRUD.record(
                test_db,
                OrgUsageEventRecord(
                    org_id=ORG_ID,
                    actor_id="api-user",
                    event_type="api_call",
                    resource_type="api",
                    resource_id=f"/api/search/{index:02d}",
                    metadata_json='{"auth_type":"api_key","method":"GET","surface":"api"}',
                ),
            )

        async def fail_raw_event_listing(*_: object, **__: object) -> list[object]:
            pytest.fail("Workspace integration activity must use bounded rollups.")

        monkeypatch.setattr(OrgUsageEventCRUD, "list_api_calls_by_org", fail_raw_event_listing)

        response = await usage_client.get(f"/api/orgs/{ORG_ID}/usage-summary/integrations")

        assert response.status_code == STATUS_OK
        body = response.json()
        assert body["total_calls"] == EXPECTED_ROLLUP_EVENTS
        assert body["api_calls"] == EXPECTED_ROLLUP_EVENTS
        assert body["mcp_calls"] == 0
        assert len(body["top_resources"]) == EXPECTED_TOP_INTEGRATION_RESOURCES

    @pytest.mark.asyncio
    async def test_integration_summary_rejects_other_org_path(self, usage_client: object) -> None:
        """Workspace integration activity should stay inside the actor's workspace."""
        response = await usage_client.get("/api/orgs/other-org/usage-summary/integrations")

        assert response.status_code == 403
