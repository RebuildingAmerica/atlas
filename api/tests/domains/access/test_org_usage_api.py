"""Tests for org-scoped renewal usage summaries."""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx
import pytest
import pytest_asyncio

from atlas.config import get_settings
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.access.principals import AuthenticatedActor
from atlas.main import create_app

if TYPE_CHECKING:
    from atlas.config import Settings

STATUS_OK = 200
STATUS_CREATED = 201
STATUS_FORBIDDEN = 403
STATUS_NOT_FOUND = 404
ORG_ID = "local"
EXPECTED_TOTAL_EVENTS = 9
EXPECTED_BRIEFS_USED = 2
EXPECTED_TEAM_WORKFLOW_ACTIONS = 3
EXPECTED_PACKET_EVENTS = 5
EXPECTED_AUDIT_EVENTS = 2
EXPECTED_INTEGRATION_EVENTS = 3
EXPECTED_API_INTEGRATION_EVENTS = 2
EXPECTED_MCP_INTEGRATION_EVENTS = 1
EXPECTED_ROLLUP_EVENTS = 25
EXPECTED_TOP_INTEGRATION_RESOURCES = 10


@pytest_asyncio.fixture
async def usage_client(test_settings: Settings) -> object:
    """Test client whose local actor can read workspace usage summaries."""
    app = create_app()

    def override_get_settings() -> Settings:
        return test_settings

    async def override_require_org_actor() -> AuthenticatedActor:
        actor = AuthenticatedActor(
            user_id="local-user",
            email="local@atlas.rebuildingus.org",
            auth_type="local",
            is_local=True,
            org_id=ORG_ID,
        )
        actor.org_role = "owner"
        return actor

    app.dependency_overrides[get_settings] = override_get_settings
    app.dependency_overrides[require_org_actor] = override_require_org_actor

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


class TestOrgUsageSchema:
    """Schema coverage for workspace renewal usage events."""

    @pytest.mark.asyncio
    async def test_init_db_creates_org_usage_events_table(self, test_db: object) -> None:
        """Fresh databases should include workspace usage events."""
        cursor = await test_db.execute("PRAGMA table_info(org_usage_events)")
        columns = {row[1] for row in await cursor.fetchall()}

        assert {
            "id",
            "org_id",
            "actor_id",
            "event_type",
            "resource_type",
            "resource_id",
            "metadata_json",
            "created_at",
        }.issubset(columns)


class TestOrgUsageApi:
    """Org-scoped renewal summary behavior."""

    @pytest.mark.asyncio
    async def test_summary_counts_workspace_usage_events(
        self,
        usage_client: object,
        test_db: object,
    ) -> None:
        """Customer success should get renewal-proof counts from product data."""
        for event_type in [
            "brief_opened",
            "brief_exported",
            "evidence_opened",
            "list_item_saved",
            "watch_created",
            "digest_viewed",
            "coverage_gap_closed",
            "api_call",
            "public_record_improved",
        ]:
            await OrgUsageEventCRUD.record(
                test_db,
                OrgUsageEventRecord(
                    org_id=ORG_ID,
                    actor_id="local-user",
                    event_type=event_type,
                    resource_type="brief" if event_type.startswith("brief") else None,
                    resource_id="brief-1" if event_type.startswith("brief") else None,
                ),
            )

        response = await usage_client.get(f"/api/orgs/{ORG_ID}/usage-summary")

        assert response.status_code == STATUS_OK
        body = response.json()
        assert body["org_id"] == ORG_ID
        assert body["total_events"] == EXPECTED_TOTAL_EVENTS
        assert body["event_counts"] == {
            "api_call": 1,
            "brief_exported": 1,
            "brief_opened": 1,
            "coverage_gap_closed": 1,
            "digest_viewed": 1,
            "evidence_opened": 1,
            "list_item_saved": 1,
            "public_record_improved": 1,
            "watch_created": 1,
        }
        assert body["renewal_signals"]["briefs_used"] == EXPECTED_BRIEFS_USED
        assert body["renewal_signals"]["team_workflow_actions"] == EXPECTED_TEAM_WORKFLOW_ACTIONS
        assert body["renewal_signals"]["coverage_gaps_closed"] == 1
        assert body["renewal_signals"]["integrations_used"] == 1
        assert body["renewal_signals"]["public_records_improved"] == 1

    @pytest.mark.asyncio
    async def test_summary_rejects_other_org_path(self, usage_client: object) -> None:
        """Usage summaries should stay inside the actor's workspace."""
        response = await usage_client.get("/api/orgs/other-org/usage-summary")

        assert response.status_code == STATUS_FORBIDDEN

    @pytest.mark.asyncio
    async def test_audit_log_lists_workspace_events_without_private_metadata(
        self,
        usage_client: object,
        test_db: object,
    ) -> None:
        """Admins should see recent usage events without private metadata leakage."""
        older_event = await OrgUsageEventCRUD.record(
            test_db,
            OrgUsageEventRecord(
                org_id=ORG_ID,
                actor_id="local-user",
                event_type="brief_opened",
                resource_type="brief",
                resource_id="brief-1",
                metadata_json='{"private_note":"Keep this out of customer audit logs."}',
            ),
        )
        newer_event = await OrgUsageEventCRUD.record(
            test_db,
            OrgUsageEventRecord(
                org_id=ORG_ID,
                actor_id="local-user",
                event_type="api_call",
                resource_type="api",
                resource_id="GET /api/profiles/{slug}",
                metadata_json='{"request_path":"/api/profiles/private-detail"}',
            ),
        )
        await OrgUsageEventCRUD.record(
            test_db,
            OrgUsageEventRecord(
                org_id="other-org",
                actor_id="other-user",
                event_type="brief_exported",
                resource_type="brief",
                resource_id="other-brief",
            ),
        )
        await test_db.execute(
            "UPDATE org_usage_events SET created_at = ? WHERE id = ?",
            ("2026-07-03T09:00:00.000Z", older_event.id),
        )
        await test_db.execute(
            "UPDATE org_usage_events SET created_at = ? WHERE id = ?",
            ("2026-07-03T10:00:00.000Z", newer_event.id),
        )
        await test_db.commit()

        response = await usage_client.get(
            f"/api/orgs/{ORG_ID}/usage-summary/audit-log?limit=2&offset=0"
        )

        assert response.status_code == STATUS_OK
        body = response.json()
        assert body["org_id"] == ORG_ID
        assert body["total"] == EXPECTED_AUDIT_EVENTS
        assert body["limit"] == EXPECTED_AUDIT_EVENTS
        assert body["offset"] == 0
        assert body["data_boundary"] == {
            "metadata_included": False,
            "session_replay_included": False,
            "statement": (
                "The audit log shows timestamped workspace usage events without private "
                "metadata or behavioral session replay."
            ),
        }
        assert [item["id"] for item in body["items"]] == [newer_event.id, older_event.id]
        assert [item["event_type"] for item in body["items"]] == ["api_call", "brief_opened"]
        assert all("metadata_json" not in item for item in body["items"])

    @pytest.mark.asyncio
    async def test_audit_log_rejects_other_org_path(self, usage_client: object) -> None:
        """Usage audit logs should stay inside the actor's workspace."""
        response = await usage_client.get("/api/orgs/other-org/usage-summary/audit-log")

        assert response.status_code == STATUS_FORBIDDEN

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
            ("2026-07-03T09:00:00.000Z", api_event.id),
        )
        await test_db.execute(
            "UPDATE org_usage_events SET created_at = ? WHERE id = ?",
            ("2026-07-03T10:00:00.000Z", second_api_event.id),
        )
        await test_db.execute(
            "UPDATE org_usage_events SET created_at = ? WHERE id = ?",
            ("2026-07-03T11:00:00.000Z", mcp_event.id),
        )
        await test_db.commit()

        response = await usage_client.get(f"/api/orgs/{ORG_ID}/usage-summary/integrations")

        assert response.status_code == STATUS_OK
        body = response.json()
        assert body["org_id"] == ORG_ID
        assert body["total_calls"] == EXPECTED_INTEGRATION_EVENTS
        assert body["api_calls"] == EXPECTED_API_INTEGRATION_EVENTS
        assert body["mcp_calls"] == EXPECTED_MCP_INTEGRATION_EVENTS
        assert body["last_seen_at"] == "2026-07-03T11:00:00.000Z"
        assert body["top_resources"] == [
            {
                "resource_id": "/api/public-directories",
                "surface": "api",
                "total_calls": EXPECTED_API_INTEGRATION_EVENTS,
                "last_seen_at": "2026-07-03T10:00:00.000Z",
            },
            {
                "resource_id": "/mcp",
                "surface": "mcp",
                "total_calls": EXPECTED_MCP_INTEGRATION_EVENTS,
                "last_seen_at": "2026-07-03T11:00:00.000Z",
            },
        ]
        assert body["data_boundary"] == {
            "request_metadata_included": False,
            "session_replay_included": False,
            "statement": (
                "Integration monitoring shows counts, surfaces, routes, and last-seen times "
                "without request metadata or behavioral session replay."
            ),
        }

    @pytest.mark.asyncio
    async def test_integration_summary_uses_bounded_resource_rollup(
        self,
        usage_client: object,
        test_db: object,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Integration monitoring should not load every raw API call into the route."""
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
            pytest.fail("Integration monitoring must use bounded rollups.")

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
        """Integration monitoring should stay inside the actor's workspace."""
        response = await usage_client.get("/api/orgs/other-org/usage-summary/integrations")

        assert response.status_code == STATUS_FORBIDDEN

    @pytest.mark.asyncio
    async def test_evidence_open_records_source_usage_event(
        self,
        usage_client: object,
        test_db: object,
        sample_source: str,
    ) -> None:
        """Opening a source receipt should become renewal proof without session replay."""
        response = await usage_client.post(
            f"/api/orgs/{ORG_ID}/usage-summary/evidence-opens",
            json={"source_id": sample_source, "surface": "brief"},
        )

        assert response.status_code == STATUS_CREATED
        body = response.json()
        assert body["event_type"] == "evidence_opened"
        assert body["resource_type"] == "source"
        assert body["resource_id"] == sample_source
        assert await OrgUsageEventCRUD.count_by_type(test_db, org_id=ORG_ID) == {
            "evidence_opened": 1
        }

    @pytest.mark.asyncio
    async def test_evidence_open_rejects_unknown_source(self, usage_client: object) -> None:
        """Evidence-open events should only count real source receipts."""
        response = await usage_client.post(
            f"/api/orgs/{ORG_ID}/usage-summary/evidence-opens",
            json={"source_id": "missing-source", "surface": "brief"},
        )

        assert response.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_renewal_packet_exports_customer_success_json(
        self,
        usage_client: object,
        test_db: object,
    ) -> None:
        """Customer success should get a portable renewal packet from usage data."""
        for event_type in [
            "brief_opened",
            "brief_exported",
            "list_item_saved",
            "coverage_gap_closed",
            "public_record_improved",
        ]:
            await OrgUsageEventCRUD.record(
                test_db,
                OrgUsageEventRecord(
                    org_id=ORG_ID,
                    actor_id="local-user",
                    event_type=event_type,
                ),
            )

        response = await usage_client.get(f"/api/orgs/{ORG_ID}/usage-summary/renewal-packet")

        assert response.status_code == STATUS_OK
        body = response.json()
        assert body["format"] == "json"
        assert body["org_id"] == ORG_ID
        assert body["summary"]["total_events"] == EXPECTED_PACKET_EVENTS
        assert body["summary"]["renewal_signals"]["briefs_used"] == EXPECTED_BRIEFS_USED
        assert body["summary"]["renewal_signals"]["coverage_gaps_closed"] == 1
        assert body["summary"]["renewal_signals"]["public_records_improved"] == 1
        assert body["metrics"][0] == {
            "label": "Briefs used",
            "value": EXPECTED_BRIEFS_USED,
            "detail": "Brief opens and exports.",
        }
        assert body["data_boundary"] == {
            "private_workspace_notes_included": False,
            "session_replay_included": False,
            "statement": (
                "The renewal packet summarizes product outcomes without private notes "
                "or behavioral session replay."
            ),
        }
        assert "Briefs used: 2" in body["highlights"]

    @pytest.mark.asyncio
    async def test_renewal_packet_exports_markdown(
        self,
        usage_client: object,
        test_db: object,
    ) -> None:
        """Customer success should be able to download a readable renewal packet."""
        await OrgUsageEventCRUD.record(
            test_db,
            OrgUsageEventRecord(
                org_id=ORG_ID,
                actor_id="local-user",
                event_type="public_record_improved",
            ),
        )

        response = await usage_client.get(
            f"/api/orgs/{ORG_ID}/usage-summary/renewal-packet?format=markdown"
        )

        assert response.status_code == STATUS_OK
        assert response.headers["content-type"].startswith("text/markdown")
        assert response.headers["content-disposition"] == (
            f'attachment; filename="atlas-renewal-{ORG_ID}.md"'
        )
        assert "# Atlas renewal packet" in response.text
        assert "Public records improved: 1" in response.text

    @pytest.mark.asyncio
    async def test_renewal_packet_rejects_other_org_path(self, usage_client: object) -> None:
        """Renewal packets should stay inside the actor's workspace."""
        response = await usage_client.get("/api/orgs/other-org/usage-summary/renewal-packet")

        assert response.status_code == STATUS_FORBIDDEN
