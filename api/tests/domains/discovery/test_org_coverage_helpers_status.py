"""Tests for coverage target status and basic validation helpers."""
# ruff: noqa

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery import api_org_coverage as coverage_api
from atlas.domains.discovery.coverage_targets import CoverageTargetModel
from atlas.domains.discovery.models import DiscoveryRunCRUD
from atlas.models import EntryCRUD


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        ("covered", "Current records and sources."),
        ("thin", "Fewer than 3 records or sources."),
        ("stale", "Not reviewed in 90 days."),
        ("blocked", "Latest review failed."),
        ("unknown", "No linked records yet."),
    ],
)
def test_status_explanation_covers_all_report_phrases(status: str, expected: str) -> None:
    """Status explanations should stay plain and user-facing."""
    target = CoverageTargetModel(
        id="target",
        org_id="local",
        name="Target",
        geography="Kansas City, MO",
        issue_areas=["housing_affordability"],
        actor_types=["organization"],
        source_types=["community_archive"],
        status=status,  # type: ignore[arg-type]
        status_reason="reason",
        review_state="needs_research",
        gaps=[],
        next_actions=[],
        records_found=0,
        sources_reviewed=0,
        linked_discovery_run_ids=[],
        linked_entry_ids=[],
        last_run_at=None,
        last_reviewed_at=None,
        created_by="local-user",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    assert coverage_api._status_explanation(target) == expected


@pytest.mark.asyncio
async def test_validate_target_fields_rejects_bad_issue_area_and_missing_links(
    test_db: object,
) -> None:
    """Validation should reject unsupported issue areas and cross-workspace links."""
    with pytest.raises(HTTPException) as exc_info:
        await coverage_api._validate_target_fields(
            test_db,
            org_id="local",
            issue_areas=["not-a-real-issue"],
            linked_discovery_run_ids=[],
            linked_entry_ids=[],
        )
    assert exc_info.value.status_code == 400

    run_id = await DiscoveryRunCRUD.create(
        test_db,
        location_query="Kansas City, MO",
        state="MO",
        issue_areas=["housing_affordability"],
    )
    await OwnershipCRUD.create_ownership(
        test_db,
        resource_id=run_id,
        resource_type="discovery_run",
        org_id="other",
        visibility="private",
        created_by="other-user",
    )
    with pytest.raises(HTTPException) as exc_info:
        await coverage_api._validate_target_fields(
            test_db,
            org_id="local",
            issue_areas=["housing_affordability"],
            linked_discovery_run_ids=[run_id],
            linked_entry_ids=[],
        )
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_detail_entry_returns_none_for_missing_row(
    test_db: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Missing coverage entries should stay missing."""
    monkeypatch.setattr(EntryCRUD, "get_with_sources", AsyncMock(return_value=(None, [])))
    assert await coverage_api._detail_entry(test_db, "entry-missing") is None


@pytest.mark.asyncio
async def test_validate_target_fields_rejects_missing_entry_reference(test_db: object) -> None:
    """Missing imported entries should trigger a 404 validation failure."""
    with pytest.raises(HTTPException) as exc_info:
        await coverage_api._validate_target_fields(
            test_db,
            org_id="local",
            issue_areas=["housing_affordability"],
            linked_discovery_run_ids=[],
            linked_entry_ids=["missing-entry"],
        )
    assert exc_info.value.status_code == 404
