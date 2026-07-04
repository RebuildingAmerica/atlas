"""Tests for org-scoped coverage targets."""

from __future__ import annotations

import csv
import io
from datetime import UTC, datetime, timedelta
from textwrap import dedent
from typing import TYPE_CHECKING

import httpx
import pytest
import pytest_asyncio

from atlas.config import get_settings
from atlas.domains.access.capabilities import ResolvedCapabilities
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.models import DiscoveryRunCRUD
from atlas.main import create_app
from atlas.models import EntryCRUD, SourceCRUD

if TYPE_CHECKING:
    from atlas.config import Settings

STATUS_OK = 200
STATUS_CREATED = 201
STATUS_BAD_REQUEST = 400
STATUS_FORBIDDEN = 403
COVERED_RECORDS = 4
COVERED_SOURCES = 5
COVERAGE_STALE_DAYS = 90
IMPORTED_TARGET_COUNT = 2
INVALID_IMPORT_ROW = 3

ORG_ID = "local"


@pytest_asyncio.fixture
async def capable_test_client(test_settings: Settings) -> object:
    """Test client whose local actor can manage coverage targets."""
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
        actor.resolved_capabilities = ResolvedCapabilities(
            capabilities=frozenset({"monitoring.watchlists", "research.run", "workspace.export"}),
            limits={},
        )
        return actor

    app.dependency_overrides[get_settings] = override_get_settings
    app.dependency_overrides[require_org_actor] = override_require_org_actor

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


async def _create_entry_with_source(test_db: object, name: str) -> str:
    """Create an entry linked to one source receipt."""
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name=name,
        description="Coverage target evidence.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )
    source_id = await SourceCRUD.create(
        test_db,
        url=f"https://example.test/{entry_id}",
        source_type="community_archive",
        extraction_method="manual",
    )
    await SourceCRUD.link_to_entry(test_db, entry_id, source_id)
    return entry_id


async def _create_completed_run(
    test_db: object,
    *,
    entries_confirmed: int,
    sources_processed: int,
    completed_at: datetime | None = None,
) -> str:
    """Create a private completed discovery run with summary counts."""
    run_id = await DiscoveryRunCRUD.create(
        test_db,
        location_query="Kansas City, MO",
        state="MO",
        issue_areas=["housing_affordability"],
        research_goal="coverage_review",
    )
    await DiscoveryRunCRUD.update(
        test_db,
        run_id,
        status="completed",
        completed_at=(completed_at or datetime.now(UTC)).isoformat(),
        entries_confirmed=entries_confirmed,
        sources_processed=sources_processed,
    )
    await OwnershipCRUD.create_ownership(
        test_db,
        resource_id=run_id,
        resource_type="discovery_run",
        org_id=ORG_ID,
        visibility="private",
        created_by="local-user",
    )
    return run_id


def _target_payload(
    *,
    linked_discovery_run_ids: list[str] | None = None,
    linked_entry_ids: list[str] | None = None,
    last_reviewed_at: str | None = None,
) -> dict[str, object]:
    """Return a coverage-target create payload."""
    payload: dict[str, object] = {
        "name": "Kansas City tenant power",
        "geography": "Kansas City, MO",
        "issue_areas": ["housing_affordability"],
        "actor_types": ["organization"],
        "source_types": ["community_archive"],
        "linked_discovery_run_ids": linked_discovery_run_ids or [],
        "linked_entry_ids": linked_entry_ids or [],
        "gaps": [
            {
                "label": "County tenant groups",
                "detail": "Review county-level tenant organizations.",
            }
        ],
        "next_actions": ["Review county source coverage"],
    }
    if last_reviewed_at is not None:
        payload["last_reviewed_at"] = last_reviewed_at
    return payload


class TestOrgCoverageTargetsSchema:
    """Schema coverage for coverage targets."""

    @pytest.mark.asyncio
    async def test_init_db_creates_coverage_target_tables(self, test_db: object) -> None:
        """Fresh databases should include coverage target and linkage tables."""
        target_cursor = await test_db.execute("PRAGMA table_info(org_coverage_targets)")
        target_columns = {row[1] for row in await target_cursor.fetchall()}

        assert {
            "id",
            "org_id",
            "name",
            "geography",
            "issue_areas_json",
            "actor_types_json",
            "source_types_json",
            "status",
            "status_reason",
            "review_state",
            "gaps_json",
            "next_actions_json",
            "last_run_at",
            "last_reviewed_at",
            "created_by",
            "created_at",
            "updated_at",
        }.issubset(target_columns)

        run_cursor = await test_db.execute("PRAGMA table_info(org_coverage_target_runs)")
        run_columns = {row[1] for row in await run_cursor.fetchall()}
        assert {"target_id", "run_id", "created_at"}.issubset(run_columns)

        entry_cursor = await test_db.execute("PRAGMA table_info(org_coverage_target_entries)")
        entry_columns = {row[1] for row in await entry_cursor.fetchall()}
        assert {"target_id", "entry_id", "created_at"}.issubset(entry_columns)


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
