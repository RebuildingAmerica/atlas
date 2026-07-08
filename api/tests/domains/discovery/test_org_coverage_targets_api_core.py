"""Core org coverage target behavior tests."""
# ruff: noqa

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from textwrap import dedent

import pytest
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD

from tests.domains.discovery.org_coverage_targets_support import (
    COVERAGE_STALE_DAYS,
    COVERED_RECORDS,
    COVERED_SOURCES,
    IMPORTED_TARGET_COUNT,
    INVALID_IMPORT_ROW,
    ORG_ID,
    STATUS_BAD_REQUEST,
    STATUS_CREATED,
    STATUS_OK,
    _create_completed_run,
    _create_entry_with_source,
    _target_payload,
)


class TestOrgCoverageTargetsApi:
    """Org-scoped coverage target behavior."""

    @pytest.mark.asyncio
    async def test_create_unknown_target_without_linked_evidence(
        self, capable_test_client: object
    ) -> None:
        """A target without linked runs or records should be honestly unknown."""
        response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/coverage-targets",
            json=_target_payload(),
        )

        assert response.status_code == STATUS_CREATED
        body = response.json()
        assert body["name"] == "Kansas City tenant power"
        assert body["status"] == "unknown"
        assert body["records_found"] == 0
        assert body["sources_reviewed"] == 0
        assert body["status_reason"] == "No linked discovery runs or records yet."
        assert body["review_state"] == "needs_research"
        assert body["gaps"][0]["label"] == "County tenant groups"
        assert body["next_actions"] == ["Review county source coverage"]

    @pytest.mark.asyncio
    async def test_create_thin_target_from_linked_run_and_entry(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """A target with sparse linked evidence should derive a thin status."""
        entry_id = await _create_entry_with_source(test_db, "KC Tenants")
        run_id = await _create_completed_run(
            test_db,
            entries_confirmed=1,
            sources_processed=1,
        )

        response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/coverage-targets",
            json=_target_payload(
                linked_discovery_run_ids=[run_id],
                linked_entry_ids=[entry_id],
            ),
        )

        assert response.status_code == STATUS_CREATED
        body = response.json()
        assert body["status"] == "thin"
        assert body["records_found"] == 1
        assert body["sources_reviewed"] == 1
        assert body["linked_discovery_run_ids"] == [run_id]
        assert body["linked_entry_ids"] == [entry_id]
        assert body["last_run_at"]
        assert body["status_reason"] == "Coverage has fewer than 3 records or sources."

    @pytest.mark.asyncio
    async def test_create_covered_target_from_completed_run_counts(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """Completed run counts can prove a target is covered."""
        run_id = await _create_completed_run(
            test_db,
            entries_confirmed=COVERED_RECORDS,
            sources_processed=COVERED_SOURCES,
        )

        response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/coverage-targets",
            json=_target_payload(linked_discovery_run_ids=[run_id]),
        )

        assert response.status_code == STATUS_CREATED
        body = response.json()
        assert body["status"] == "covered"
        assert body["records_found"] == COVERED_RECORDS
        assert body["sources_reviewed"] == COVERED_SOURCES
        assert body["status_reason"] == "Coverage has current records and sources."
        assert body["review_state"] == "needs_research"

    @pytest.mark.asyncio
    async def test_import_csv_creates_customer_onboarding_targets(
        self, capable_test_client: object
    ) -> None:
        """Customer success should be able to bulk-create onboarding coverage targets."""
        csv_text = dedent(
            """\
            name,geography,issue_areas,actor_types,source_types,gaps,next_actions,review_state
            "Kansas City tenant power","Kansas City, MO","housing_affordability","organization","community_archive","County tenant groups: Review county-level tenant organizations.","Review county source coverage","needs_research"
            "Nevada mutual aid","Clark County, NV","sustainable_agriculture_and_food_systems","organization;initiative","website;news","","Review mutual aid directory","in_review"
            """
        )

        response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/coverage-targets/import",
            json={"csv_text": csv_text},
        )

        assert response.status_code == STATUS_CREATED
        body = response.json()
        assert body["imported"] == IMPORTED_TARGET_COUNT
        assert body["created"][0]["name"] == "Kansas City tenant power"
        assert body["created"][0]["gaps"][0]["label"] == "County tenant groups"
        assert body["created"][1]["name"] == "Nevada mutual aid"
        assert body["created"][1]["actor_types"] == ["organization", "initiative"]
        assert body["created"][1]["source_types"] == ["website", "news"]
        assert body["created"][1]["review_state"] == "in_review"

    @pytest.mark.asyncio
    async def test_import_csv_rejects_invalid_rows_without_partial_creation(
        self, capable_test_client: object
    ) -> None:
        """A bad onboarding row should not leave a half-imported workspace."""
        csv_text = dedent(
            """\
            name,geography,issue_areas,actor_types,source_types
            "Kansas City tenant power","Kansas City, MO","housing_affordability","organization","community_archive"
            "Bad scope","Clark County, NV","not_an_issue","organization","website"
            """
        )

        response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/coverage-targets/import",
            json={"csv_text": csv_text},
        )
        list_response = await capable_test_client.get(f"/api/orgs/{ORG_ID}/coverage-targets")

        assert response.status_code == STATUS_BAD_REQUEST
        body = response.json()
        assert body["detail"]["message"] == "Coverage import failed."
        assert body["detail"]["errors"][0]["row"] == INVALID_IMPORT_ROW
        assert body["detail"]["errors"][0]["field"] == "issue_areas"
        assert list_response.json()["total"] == 0

    @pytest.mark.asyncio
    async def test_update_review_state_marks_target_ready_for_customer_delivery(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """Research ops should separate needs-research targets from deliverable ones."""
        run_id = await _create_completed_run(
            test_db,
            entries_confirmed=COVERED_RECORDS,
            sources_processed=COVERED_SOURCES,
        )
        create_response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/coverage-targets",
            json=_target_payload(linked_discovery_run_ids=[run_id]),
        )
        target_id = create_response.json()["id"]

        response = await capable_test_client.patch(
            f"/api/orgs/{ORG_ID}/coverage-targets/{target_id}",
            json={"review_state": "ready_for_delivery"},
        )

        assert response.status_code == STATUS_OK
        body = response.json()
        assert body["status"] == "covered"
        assert body["review_state"] == "ready_for_delivery"

    @pytest.mark.asyncio
    async def test_create_stale_target_from_old_completed_run(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """Old evidence should not keep a coverage target marked covered."""
        stale_completed_at = datetime.now(UTC) - timedelta(days=COVERAGE_STALE_DAYS + 1)
        run_id = await _create_completed_run(
            test_db,
            entries_confirmed=COVERED_RECORDS,
            sources_processed=COVERED_SOURCES,
            completed_at=stale_completed_at,
        )

        response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/coverage-targets",
            json=_target_payload(linked_discovery_run_ids=[run_id]),
        )

        assert response.status_code == STATUS_CREATED
        body = response.json()
        assert body["status"] == "stale"
        assert body["records_found"] == COVERED_RECORDS
        assert body["sources_reviewed"] == COVERED_SOURCES
        assert body["status_reason"] == "Coverage has not been reviewed in the last 90 days."

    @pytest.mark.asyncio
    async def test_recent_review_keeps_old_run_current(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """A current human review can keep old run evidence from becoming stale."""
        stale_completed_at = datetime.now(UTC) - timedelta(days=COVERAGE_STALE_DAYS + 1)
        run_id = await _create_completed_run(
            test_db,
            entries_confirmed=COVERED_RECORDS,
            sources_processed=COVERED_SOURCES,
            completed_at=stale_completed_at,
        )

        response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/coverage-targets",
            json=_target_payload(
                linked_discovery_run_ids=[run_id],
                last_reviewed_at=datetime.now(UTC).isoformat(),
            ),
        )

        assert response.status_code == STATUS_CREATED
        body = response.json()
        assert body["status"] == "covered"
        assert body["status_reason"] == "Coverage has current records and sources."

    @pytest.mark.asyncio
    async def test_list_returns_workspace_targets(self, capable_test_client: object) -> None:
        """The workspace list should return configured coverage targets."""
        create_response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/coverage-targets",
            json=_target_payload(),
        )
        target_id = create_response.json()["id"]

        list_response = await capable_test_client.get(f"/api/orgs/{ORG_ID}/coverage-targets")

        assert list_response.status_code == STATUS_OK
        body = list_response.json()
        assert body["total"] == 1
        assert body["items"][0]["id"] == target_id
        assert body["items"][0]["status"] == "unknown"

    @pytest.mark.asyncio
    async def test_update_watched_target_status_adds_digest_event(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """A watched target should add a digest row when evidence changes status."""
        create_response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/coverage-targets",
            json=_target_payload(),
        )
        target_id = create_response.json()["id"]
        await capable_test_client.put(
            f"/api/orgs/{ORG_ID}/watches/coverage_target/{target_id}",
        )
        run_id = await _create_completed_run(
            test_db,
            entries_confirmed=COVERED_RECORDS,
            sources_processed=COVERED_SOURCES,
        )

        update_response = await capable_test_client.patch(
            f"/api/orgs/{ORG_ID}/coverage-targets/{target_id}",
            json={"linked_discovery_run_ids": [run_id]},
        )
        digest_response = await capable_test_client.get(f"/api/orgs/{ORG_ID}/watch-digest")

        assert update_response.status_code == STATUS_OK
        updated = update_response.json()
        assert updated["status"] == "covered"
        assert updated["linked_discovery_run_ids"] == [run_id]
        assert digest_response.status_code == STATUS_OK
        digest = digest_response.json()
        assert digest["coverage_signal_count"] == 1
        assert digest["source_signal_count"] == 0
        assert digest["items"][0]["event_type"] == "coverage_status_changed"
        assert digest["items"][0]["resource_type"] == "coverage_target"
        assert digest["items"][0]["resource_id"] == target_id
        assert digest["items"][0]["title"] == "Coverage changed for Kansas City tenant power"
        assert digest["items"][0]["summary"] == "Coverage changed from unknown to covered."
        assert digest["items"][0]["entry"] is None
        assert digest["items"][0]["source"] is None
        usage_counts = await OrgUsageEventCRUD.count_by_type(test_db, org_id=ORG_ID)
        assert usage_counts["coverage_gap_closed"] == 1
