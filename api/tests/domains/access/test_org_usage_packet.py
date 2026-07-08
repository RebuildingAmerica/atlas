"""Tests for org-scoped renewal usage summaries."""

from __future__ import annotations

import pytest

from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord

STATUS_OK = 200
STATUS_CREATED = 201
STATUS_FORBIDDEN = 403
STATUS_NOT_FOUND = 404
ORG_ID = "local"
EXPECTED_PACKET_EVENTS = 5
EXPECTED_BRIEFS_USED = 2


class TestOrgUsagePacket:
    """Renewal-packet behavior for workspace usage events."""

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
