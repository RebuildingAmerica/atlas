"""Tests for imported coverage target link validation."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery import api_org_coverage as coverage_api
from atlas.models import EntryCRUD


@pytest.mark.asyncio
async def test_validate_import_target_links_reports_missing_run_and_entry(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Imported link references should be checked against durable ownership rows."""
    parsed_rows = [
        coverage_api.ParsedCoverageTargetImportRow(
            row_number=2,
            request=coverage_api.CoverageTargetCreateRequest(
                name="Kansas City tenant power",
                geography="Kansas City, MO",
                issue_areas=["housing_affordability"],
                actor_types=["organization"],
                source_types=["community_archive"],
                linked_discovery_run_ids=["run-missing"],
                linked_entry_ids=["entry-missing"],
            ),
        )
    ]

    async def fake_get_ownership(
        _db: object, _resource_id: str, _resource_type: str
    ) -> object | None:
        return None

    monkeypatch.setattr(OwnershipCRUD, "get_ownership", fake_get_ownership)
    monkeypatch.setattr(EntryCRUD, "get_by_id", AsyncMock(return_value=None))

    errors = await coverage_api._validate_import_target_links(
        test_db,
        org_id="local",
        parsed_rows=parsed_rows,
    )

    assert [error.field for error in errors] == ["linked_discovery_run_ids", "linked_entry_ids"]


@pytest.mark.asyncio
async def test_validate_import_target_links_keeps_present_entries_and_foreign_runs(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Link validation should only flag the rows that are actually missing or foreign."""
    parsed_rows = [
        coverage_api.ParsedCoverageTargetImportRow(
            row_number=3,
            request=coverage_api.CoverageTargetCreateRequest(
                name="Kansas City tenant power",
                geography="Kansas City, MO",
                issue_areas=["housing_affordability"],
                actor_types=["organization"],
                source_types=["community_archive"],
                linked_discovery_run_ids=["run-foreign"],
                linked_entry_ids=["entry-present"],
            ),
        )
    ]

    monkeypatch.setattr(
        OwnershipCRUD,
        "get_ownership",
        AsyncMock(return_value=SimpleNamespace(org_id="other")),
    )
    monkeypatch.setattr(
        EntryCRUD,
        "get_by_id",
        AsyncMock(return_value=SimpleNamespace(id="entry-present")),
    )

    errors = await coverage_api._validate_import_target_links(
        test_db,
        org_id="local",
        parsed_rows=parsed_rows,
    )

    assert [error.field for error in errors] == ["linked_discovery_run_ids"]


@pytest.mark.asyncio
async def test_validate_import_target_links_accepts_matching_runs_and_entries(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Valid ownership rows should not create import-link errors."""
    parsed_rows = [
        coverage_api.ParsedCoverageTargetImportRow(
            row_number=4,
            request=coverage_api.CoverageTargetCreateRequest(
                name="Kansas City tenant power",
                geography="Kansas City, MO",
                issue_areas=["housing_affordability"],
                actor_types=["organization"],
                source_types=["community_archive"],
                linked_discovery_run_ids=["run-owned"],
                linked_entry_ids=["entry-present"],
            ),
        )
    ]

    monkeypatch.setattr(
        OwnershipCRUD,
        "get_ownership",
        AsyncMock(return_value=SimpleNamespace(org_id="local")),
    )
    monkeypatch.setattr(
        EntryCRUD,
        "get_by_id",
        AsyncMock(return_value=SimpleNamespace(id="entry-present")),
    )

    errors = await coverage_api._validate_import_target_links(
        test_db,
        org_id="local",
        parsed_rows=parsed_rows,
    )

    assert errors == []
