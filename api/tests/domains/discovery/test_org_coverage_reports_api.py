"""Tests for org-scoped coverage underwriting reports."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

import httpx
import pytest
import pytest_asyncio

from atlas.config import get_settings
from atlas.domains.access.capabilities import ResolvedCapabilities
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD, OrgUsageEventRecord
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.domains.discovery.models import DiscoveryRunCRUD
from atlas.main import create_app
from atlas.models import EntryCRUD, SourceCRUD

if TYPE_CHECKING:
    from atlas.config import Settings

STATUS_OK = 200
STATUS_FORBIDDEN = 403
ORG_ID = "local"
COVERED_RECORDS = 4
COVERED_SOURCES = 5


def _build_actor(capabilities: frozenset[str]) -> AuthenticatedActor:
    """Return a local workspace actor with explicit capabilities."""
    actor = AuthenticatedActor(
        user_id="local-user",
        email="local@atlas.rebuildingus.org",
        auth_type="local",
        is_local=True,
        org_id=ORG_ID,
    )
    actor.org_role = "owner"
    actor.resolved_capabilities = ResolvedCapabilities(capabilities=capabilities, limits={})
    return actor


async def _build_client(
    test_settings: Settings,
    *,
    capabilities: frozenset[str],
) -> object:
    """Create a test client with a capability-scoped workspace actor."""
    app = create_app()

    def override_get_settings() -> Settings:
        return test_settings

    async def override_require_org_actor() -> AuthenticatedActor:
        return _build_actor(capabilities)

    app.dependency_overrides[get_settings] = override_get_settings
    app.dependency_overrides[require_org_actor] = override_require_org_actor

    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


@pytest_asyncio.fixture
async def underwriter_client(test_settings: Settings) -> object:
    """Test client whose actor can read underwriting reports."""
    async with await _build_client(
        test_settings,
        capabilities=frozenset({"coverage.underwriting", "coverage.targets", "workspace.export"}),
    ) as client:
        yield client


@pytest_asyncio.fixture
async def coverage_client(test_settings: Settings) -> object:
    """Test client whose actor can use coverage targets but not reports."""
    async with await _build_client(
        test_settings,
        capabilities=frozenset({"coverage.targets", "workspace.export"}),
    ) as client:
        yield client


async def _create_entry_with_source(test_db: object, name: str) -> str:
    """Create a catalog entry linked to one public source receipt."""
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name=name,
        description="Coverage report evidence.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )
    source_id = await SourceCRUD.create(
        test_db,
        url=f"https://example.test/sources/{entry_id}",
        source_type="community_archive",
        extraction_method="manual",
    )
    await SourceCRUD.link_to_entry(test_db, entry_id, source_id)
    return entry_id


async def _create_completed_run(test_db: object) -> str:
    """Create an org-owned discovery run with coverage counts."""
    run_id = await DiscoveryRunCRUD.create(
        test_db,
        location_query="Kansas City, MO",
        state="MO",
        issue_areas=["housing_affordability"],
        research_goal="underwriter_report",
    )
    await DiscoveryRunCRUD.update(
        test_db,
        run_id,
        status="completed",
        completed_at=datetime.now(UTC).isoformat(),
        entries_confirmed=COVERED_RECORDS,
        sources_processed=COVERED_SOURCES,
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


async def _record_usage(test_db: object, event_type: str, times: int) -> None:
    """Record repeated usage events for the report rollup."""
    for _index in range(times):
        await OrgUsageEventCRUD.record(
            test_db,
            OrgUsageEventRecord(
                org_id=ORG_ID,
                actor_id="local-user",
                event_type=event_type,
            ),
        )


class TestOrgCoverageReportsApi:
    """Coverage underwriting report behavior."""

    @pytest.mark.asyncio
    async def test_report_aggregates_public_impact_and_source_linked_coverage(
        self,
        underwriter_client: object,
        test_db: object,
    ) -> None:
        """Underwriters should see public impact without private workspace notes."""
        entry_id = await _create_entry_with_source(test_db, "Tenant Power Network")
        run_id = await _create_completed_run(test_db)
        covered_target = await CoverageTargetCRUD.create(
            test_db,
            org_id=ORG_ID,
            name="Kansas City tenant power",
            geography="Kansas City, MO",
            issue_areas=["housing_affordability"],
            actor_types=["organization"],
            source_types=["community_archive"],
            gaps=[
                {
                    "label": "County tenant groups",
                    "detail": "Review county-level tenant organizations.",
                }
            ],
            next_actions=["Review county source coverage"],
            linked_discovery_run_ids=[run_id],
            linked_entry_ids=[entry_id],
            created_by="local-user",
        )
        unknown_target = await CoverageTargetCRUD.create(
            test_db,
            org_id=ORG_ID,
            name="Kansas City legal defense",
            geography="Kansas City, MO",
            issue_areas=["housing_affordability"],
            actor_types=["organization"],
            source_types=["legal_directory"],
            gaps=[
                {
                    "label": "Legal clinics",
                    "detail": "Confirm clinics with eviction defense capacity.",
                }
            ],
            next_actions=["Review court-help referrals"],
            linked_discovery_run_ids=[],
            linked_entry_ids=[],
            created_by="local-user",
        )
        await _record_usage(test_db, "public_record_improved", 2)
        await _record_usage(test_db, "coverage_gap_closed", 1)

        response = await underwriter_client.get(f"/api/orgs/{ORG_ID}/coverage-reports")

        assert response.status_code == STATUS_OK
        body = response.json()
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
        assert body["public_impact"] == {
            "coverage_gaps_closed": 1,
            "public_records_improved": 2,
            "records_found": COVERED_RECORDS,
            "sources_reviewed": COVERED_SOURCES,
        }
        assert body["data_boundary"] == {
            "exclusive_public_data_access": False,
            "private_workspace_notes_included": False,
            "statement": (
                "Underwriting improves public coverage, but public records remain public "
                "and private workspace notes are excluded."
            ),
        }
        targets_by_id = {target["id"]: target for target in body["targets"]}
        assert targets_by_id[covered_target.id]["linked_entry_ids"] == [entry_id]
        assert targets_by_id[covered_target.id]["linked_discovery_run_ids"] == [run_id]
        assert targets_by_id[covered_target.id]["records_found"] == COVERED_RECORDS
        assert targets_by_id[covered_target.id]["sources_reviewed"] == COVERED_SOURCES
        assert targets_by_id[unknown_target.id]["status"] == "unknown"
        assert targets_by_id[unknown_target.id]["gaps"][0]["label"] == "Legal clinics"
        assert targets_by_id[unknown_target.id]["next_actions"] == ["Review court-help referrals"]

    @pytest.mark.asyncio
    async def test_report_rejects_other_org_path(self, underwriter_client: object) -> None:
        """Underwriting reports should stay inside the actor's workspace."""
        response = await underwriter_client.get("/api/orgs/other-org/coverage-reports")

        assert response.status_code == STATUS_FORBIDDEN

    @pytest.mark.asyncio
    async def test_report_requires_underwriting_capability(self, coverage_client: object) -> None:
        """Coverage tools alone should not expose the underwriter report."""
        response = await coverage_client.get(f"/api/orgs/{ORG_ID}/coverage-reports")

        assert response.status_code == STATUS_FORBIDDEN
        assert response.json()["detail"]["capability"] == "coverage.underwriting"
