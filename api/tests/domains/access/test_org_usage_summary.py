"""Tests for org-scoped renewal usage summaries."""

from __future__ import annotations

import pytest

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord

STATUS_OK = 200
ORG_ID = "local"
EXPECTED_TOTAL_EVENTS = 9
EXPECTED_BRIEFS_USED = 2
EXPECTED_TEAM_WORKFLOW_ACTIONS = 3


class TestOrgUsageSummary:
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

        assert response.status_code == 403
