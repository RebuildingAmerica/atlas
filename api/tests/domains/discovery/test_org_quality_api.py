"""Tests for org-scoped ingestion quality summaries."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import TYPE_CHECKING
from unittest.mock import ANY

import httpx
import pytest
import pytest_asyncio

from atlas.config import get_settings
from atlas.domains.access.dependencies import require_org_actor
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.main import create_app
from atlas.models import EntryCRUD, SourceCRUD

if TYPE_CHECKING:
    from atlas.config import Settings

STATUS_OK = 200
STATUS_FORBIDDEN = 403
ORG_ID = "local"
OTHER_ORG_ID = "other-org"
DEFAULT_STALE_THRESHOLD_DAYS = 365
EXPECTED_DUPLICATE_RECORDS = 2


@pytest_asyncio.fixture
async def quality_client(test_settings: Settings) -> object:
    """Test client whose local actor can read workspace quality summaries."""
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


async def _create_owned_entry(
    test_db: object,
    *,
    name: str,
    org_id: str = ORG_ID,
    published_dates: list[date] | None = None,
) -> str:
    """Create an org-owned entry with optional linked sources."""
    entry_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name=name,
        description="Quality dashboard fixture.",
        city="Detroit",
        state="MI",
        geo_specificity="local",
    )
    await OwnershipCRUD.create_ownership(
        test_db,
        resource_id=entry_id,
        resource_type="entry",
        org_id=org_id,
        visibility="public",
        created_by="local-user",
    )
    for index, published_date in enumerate(published_dates or [], start=1):
        source_id = await SourceCRUD.create(
            test_db,
            url=f"https://example.test/{entry_id}/{index}",
            source_type="community_archive",
            extraction_method="manual",
            published_date=published_date,
        )
        await SourceCRUD.link_to_entry(test_db, entry_id, source_id)
    return entry_id


class TestOrgQualityApi:
    """Workspace quality summary behavior."""

    @pytest.mark.asyncio
    async def test_quality_summary_reports_source_duplicate_confidence_and_stale_signals(
        self,
        quality_client: object,
        test_db: object,
    ) -> None:
        """Research ops should see quality risk without inspecting raw tables."""
        fresh_date = datetime.now(UTC).date()
        stale_date = date(2020, 1, 1)
        await _create_owned_entry(
            test_db,
            name="Civic Housing Alliance",
            published_dates=[fresh_date, fresh_date],
        )
        await _create_owned_entry(
            test_db,
            name="Tenant Legal Clinic",
            published_dates=[stale_date],
        )
        await _create_owned_entry(test_db, name="Duplicate Worker Center")
        await _create_owned_entry(test_db, name="Duplicate Worker Center")
        await _create_owned_entry(
            test_db,
            name="Other Org Stale Record",
            org_id=OTHER_ORG_ID,
            published_dates=[stale_date],
        )

        response = await quality_client.get(f"/api/orgs/{ORG_ID}/quality-summary")

        assert response.status_code == STATUS_OK
        body = response.json()
        assert body["org_id"] == ORG_ID
        assert body["source_coverage"] == {
            "total_records": 4,
            "source_backed_records": 2,
            "unsourced_records": 2,
            "coverage_percent": 50.0,
        }
        assert body["duplicate_risk"]["cluster_count"] == 1
        assert body["duplicate_risk"]["record_count"] == EXPECTED_DUPLICATE_RECORDS
        assert body["duplicate_risk"]["clusters"][0]["record_count"] == EXPECTED_DUPLICATE_RECORDS
        assert [record["name"] for record in body["duplicate_risk"]["clusters"][0]["records"]] == [
            "Duplicate Worker Center",
            "Duplicate Worker Center",
        ]
        assert body["confidence_distribution"] == [
            {"state": "corroborated", "record_count": 1},
            {"state": "partial", "record_count": 1},
            {"state": "unverified", "record_count": 2},
        ]
        assert body["stale_records"]["threshold_days"] == DEFAULT_STALE_THRESHOLD_DAYS
        assert body["stale_records"]["record_count"] == 1
        assert body["stale_records"]["records"] == [
            {
                "id": ANY,
                "name": "Tenant Legal Clinic",
                "latest_source_date": "2020-01-01",
                "source_count": 1,
            }
        ]
        assert body["data_boundary"] == {
            "private_notes_included": False,
            "statement": "Quality signals are derived from workspace-owned records and linked source receipts; private notes are excluded.",
        }

    @pytest.mark.asyncio
    async def test_quality_summary_rejects_other_org_path(
        self,
        quality_client: object,
    ) -> None:
        """Quality summaries should stay inside the actor's workspace."""
        response = await quality_client.get(f"/api/orgs/{OTHER_ORG_ID}/quality-summary")

        assert response.status_code == STATUS_FORBIDDEN
