"""Tests for coverage target route error paths and update helpers."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from atlas.domains.discovery import api_org_coverage as coverage_api
from atlas.domains.discovery.coverage_targets import CoverageTargetModel


@pytest.mark.asyncio
async def test_get_and_update_org_coverage_target_error_paths(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Coverage target routes should fail plainly on missing or empty input."""
    actor = SimpleNamespace(org_id="local")
    response = SimpleNamespace(status_code=None, headers={})

    monkeypatch.setattr(coverage_api, "_verify_org_access", lambda _actor, _org_id: None)
    monkeypatch.setattr(coverage_api.CoverageTargetCRUD, "get", AsyncMock(return_value=None))

    with pytest.raises(HTTPException) as exc_info:
        await coverage_api.get_org_coverage_target(
            org_id="local",
            target_id="missing",
            response=response,
            actor=actor,
            db=test_db,
        )
    assert exc_info.value.status_code == 404

    with pytest.raises(HTTPException) as exc_info:
        await coverage_api.update_org_coverage_target(
            org_id="local",
            target_id="missing",
            req=coverage_api.CoverageTargetUpdateRequest(),
            response=response,
            actor=actor,
            db=test_db,
        )
    assert exc_info.value.status_code == 400

    target = CoverageTargetModel(
        id="target",
        org_id="local",
        name="Target",
        geography="Kansas City, MO",
        issue_areas=["housing_affordability"],
        actor_types=["organization"],
        source_types=["community_archive"],
        status="unknown",
        status_reason="No linked records yet.",
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
    monkeypatch.setattr(coverage_api.CoverageTargetCRUD, "get", AsyncMock(return_value=target))
    monkeypatch.setattr(coverage_api.CoverageTargetCRUD, "update", AsyncMock(return_value=None))

    with pytest.raises(HTTPException) as exc_info:
        await coverage_api.update_org_coverage_target(
            org_id="local",
            target_id="target",
            req=coverage_api.CoverageTargetUpdateRequest(name="Updated"),
            response=response,
            actor=actor,
            db=test_db,
        )
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_update_org_coverage_target_missing_target_after_field_validation(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Updates should still fail plainly when the target disappears before update."""
    actor = SimpleNamespace(org_id="local")
    response = SimpleNamespace(status_code=None, headers={})
    monkeypatch.setattr(coverage_api, "_verify_org_access", lambda _actor, _org_id: None)
    monkeypatch.setattr(coverage_api.CoverageTargetCRUD, "get", AsyncMock(return_value=None))

    with pytest.raises(HTTPException) as exc_info:
        await coverage_api.update_org_coverage_target(
            org_id="local",
            target_id="missing",
            req=coverage_api.CoverageTargetUpdateRequest(name="Updated"),
            response=response,
            actor=actor,
            db=test_db,
        )

    assert exc_info.value.status_code == 404


def test_target_update_input_preserves_existing_values_when_fields_are_omitted() -> None:
    """Partial updates should only replace the fields the caller actually sent."""
    target = CoverageTargetModel(
        id="target",
        org_id="local",
        name="Original",
        geography="Kansas City, MO",
        issue_areas=["housing_affordability"],
        actor_types=["organization"],
        source_types=["community_archive"],
        status="unknown",
        status_reason="No linked records yet.",
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
    req = coverage_api.CoverageTargetUpdateRequest(name="Updated name")

    update_input = coverage_api._target_update_input(target, req)

    assert update_input.name == "Updated name"
    assert update_input.issue_areas == ["housing_affordability"]
    assert update_input.review_state == "needs_research"
