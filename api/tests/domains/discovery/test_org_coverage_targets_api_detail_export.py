"""Coverage target detail and export tests."""
# ruff: noqa

from __future__ import annotations

import csv
import io

import pytest

from tests.domains.discovery.org_coverage_targets_support import (
    COVERED_RECORDS,
    COVERED_SOURCES,
    ORG_ID,
    STATUS_FORBIDDEN,
    STATUS_OK,
    _create_completed_run,
    _create_entry_with_source,
    _target_payload,
)


class TestOrgCoverageTargetsApiDetailExport:
    """Detail and export behavior for coverage targets."""

    @pytest.mark.asyncio
    async def test_get_target_detail_returns_linked_runs_and_entries(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """The target detail endpoint should expose evidence needed for review."""
        entry_id = await _create_entry_with_source(test_db, "KC Tenants")
        run_id = await _create_completed_run(
            test_db,
            entries_confirmed=1,
            sources_processed=1,
        )
        create_response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/coverage-targets",
            json=_target_payload(
                linked_discovery_run_ids=[run_id],
                linked_entry_ids=[entry_id],
            ),
        )
        target_id = create_response.json()["id"]

        response = await capable_test_client.get(
            f"/api/orgs/{ORG_ID}/coverage-targets/{target_id}",
        )

        assert response.status_code == STATUS_OK
        body = response.json()
        assert body["target"]["id"] == target_id
        assert body["target"]["status"] == "thin"
        assert body["discovery_runs"][0]["id"] == run_id
        assert body["discovery_runs"][0]["location_query"] == "Kansas City, MO"
        assert body["discovery_runs"][0]["entries_confirmed"] == 1
        assert body["entries"][0]["id"] == entry_id
        assert body["entries"][0]["name"] == "KC Tenants"
        assert body["entries"][0]["source_count"] == 1
        assert body["entries"][0]["sources"][0]["url"].startswith("https://example.test/")

    @pytest.mark.asyncio
    async def test_get_target_detail_rejects_other_workspace_target(
        self, capable_test_client: object
    ) -> None:
        """A workspace should not be able to inspect another org's target."""
        create_response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/coverage-targets",
            json=_target_payload(),
        )
        target_id = create_response.json()["id"]

        response = await capable_test_client.get(
            f"/api/orgs/other-org/coverage-targets/{target_id}",
        )

        assert response.status_code == STATUS_FORBIDDEN

    @pytest.mark.asyncio
    async def test_export_json_returns_coverage_report_summary(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """The JSON export should summarize target status and portable next actions."""
        covered_run_id = await _create_completed_run(
            test_db,
            entries_confirmed=COVERED_RECORDS,
            sources_processed=COVERED_SOURCES,
        )
        covered_response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/coverage-targets",
            json=_target_payload(linked_discovery_run_ids=[covered_run_id]),
        )
        unknown_response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/coverage-targets",
            json={
                **_target_payload(),
                "name": "Kansas City tenant legal support",
                "gaps": [
                    {
                        "label": "Legal clinics",
                        "detail": "Confirm clinics with eviction defense capacity.",
                    }
                ],
                "next_actions": ["Review court-help referrals"],
            },
        )

        response = await capable_test_client.get(
            f"/api/orgs/{ORG_ID}/coverage-targets/export",
        )

        assert response.status_code == STATUS_OK
        body = response.json()
        assert body["format"] == "json"
        assert body["org_id"] == ORG_ID
        assert body["summary"] == {
            "total_targets": 2,
            "covered": 1,
            "thin": 0,
            "unknown": 1,
            "stale": 0,
            "blocked": 0,
            "needs_work": 1,
            "records_found": COVERED_RECORDS,
            "sources_reviewed": COVERED_SOURCES,
            "open_gaps": 2,
            "next_actions": 2,
        }
        targets_by_id = {target["id"]: target for target in body["targets"]}
        assert targets_by_id[covered_response.json()["id"]]["status_explanation"] == (
            "Current records and sources."
        )
        assert targets_by_id[unknown_response.json()["id"]]["status_explanation"] == (
            "No linked records yet."
        )
        assert targets_by_id[unknown_response.json()["id"]]["gaps"][0]["label"] == ("Legal clinics")

    @pytest.mark.asyncio
    async def test_export_csv_returns_portable_coverage_rows(
        self, capable_test_client: object, test_db: object
    ) -> None:
        """The CSV export should preserve target scope, status, gaps, and actions."""
        run_id = await _create_completed_run(
            test_db,
            entries_confirmed=COVERED_RECORDS,
            sources_processed=COVERED_SOURCES,
        )
        create_response = await capable_test_client.post(
            f"/api/orgs/{ORG_ID}/coverage-targets",
            json=_target_payload(linked_discovery_run_ids=[run_id]),
        )

        response = await capable_test_client.get(
            f"/api/orgs/{ORG_ID}/coverage-targets/export?format=csv",
        )

        assert response.status_code == STATUS_OK
        assert response.headers["content-type"].startswith("text/csv")
        assert response.headers["content-disposition"] == (
            f'attachment; filename="atlas-coverage-{ORG_ID}.csv"'
        )
        reader = csv.DictReader(io.StringIO(response.text))
        rows = list(reader)
        assert len(rows) == 1
        assert rows[0]["target_id"] == create_response.json()["id"]
        assert rows[0]["name"] == "Kansas City tenant power"
        assert rows[0]["geography"] == "Kansas City, MO"
        assert rows[0]["issue_areas"] == "housing_affordability"
        assert rows[0]["status"] == "covered"
        assert rows[0]["status_explanation"] == "Current records and sources."
        assert rows[0]["review_state"] == "needs_research"
        assert rows[0]["records_found"] == str(COVERED_RECORDS)
        assert rows[0]["sources_reviewed"] == str(COVERED_SOURCES)
        assert rows[0]["gaps"] == "County tenant groups: Review county-level tenant organizations."
        assert rows[0]["next_actions"] == "Review county source coverage"
