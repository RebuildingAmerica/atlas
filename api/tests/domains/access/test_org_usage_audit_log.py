"""Tests for org-scoped renewal usage summaries."""

from __future__ import annotations

import pytest

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord

STATUS_OK = 200
ORG_ID = "local"
EXPECTED_AUDIT_EVENTS = 2


class TestOrgUsageAuditLog:
    """Audit-log behavior for workspace usage events."""

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

        assert response.status_code == 403
