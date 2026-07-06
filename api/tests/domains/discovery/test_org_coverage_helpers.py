"""Tests for org coverage target helper branches."""
# ruff: noqa

from __future__ import annotations

import csv
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


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("  label  ", "label"),
        ("\ufeffheader", "header"),
    ],
)
def test_import_header_normalization_strips_whitespace_and_bom(
    value: str,
    expected: str,
) -> None:
    """CSV headers should normalize before validation."""
    assert coverage_api._normalize_import_header(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, []),
        ("one; two ; ; three", ["one", "two", "three"]),
    ],
)
def test_split_import_cell_drops_blank_segments(
    value: str | None,
    expected: list[str],
) -> None:
    """Delimited import cells should keep only real values."""
    assert coverage_api._split_import_cell(value) == expected


def test_parse_import_review_state_reports_invalid_values() -> None:
    """Import review-state validation should record a row-level error."""
    errors: list[coverage_api.CoverageTargetImportError] = []
    assert (
        coverage_api._parse_import_review_state(
            "not-valid",
            row_number=2,
            errors=errors,
        )
        == "needs_research"
    )
    assert errors[0].field == "review_state"


def test_parse_import_review_state_accepts_ready_for_delivery() -> None:
    """A valid delivery-ready state should pass through unchanged."""
    errors: list[coverage_api.CoverageTargetImportError] = []
    assert (
        coverage_api._parse_import_review_state(
            "ready_for_delivery",
            row_number=2,
            errors=errors,
        )
        == "ready_for_delivery"
    )
    assert errors == []


def test_parse_import_gaps_reports_invalid_segments() -> None:
    """Gap parsing should reject malformed label/detail pairs."""
    errors: list[coverage_api.CoverageTargetImportError] = []
    parsed = coverage_api._parse_import_gaps(
        "Bad segment; Good label: detail",
        row_number=2,
        errors=errors,
    )
    assert len(parsed) == 1
    assert errors[0].field == "gaps"


@pytest.mark.parametrize(
    ("fieldnames", "expected_field"),
    [
        (None, "csv"),
        (["", "name", "geography", "issue_areas", "actor_types", "source_types"], "csv"),
        (["name", "bogus", "geography", "issue_areas", "actor_types", "source_types"], "bogus"),
        (["name", "name", "geography", "issue_areas", "actor_types", "source_types"], "name"),
        (["name", "geography", "issue_areas", "actor_types"], "source_types"),
    ],
)
def test_validate_import_headers_reports_header_problems(
    fieldnames: list[str] | None,
    expected_field: str,
) -> None:
    """CSV import headers should fail closed when malformed or incomplete."""
    header_map, errors = coverage_api._validate_import_headers(fieldnames)
    assert errors
    assert errors[0].field == expected_field
    if fieldnames is not None:
        assert isinstance(header_map, dict)


def test_normalized_import_row_flags_extra_values() -> None:
    """Rows with extra cells should report a CSV shape error."""
    errors: list[coverage_api.CoverageTargetImportError] = []
    row = coverage_api._normalized_import_row(
        {None: ["extra"], "name": "A"},
        {"name": "name"},
        row_number=2,
        errors=errors,
    )
    assert row == {"name": "A"}
    assert errors[0].field == "csv"


def test_normalized_import_row_skips_unknown_and_none_headers() -> None:
    """A blank CSV header should surface a row-shape error."""
    errors: list[coverage_api.CoverageTargetImportError] = []
    row = coverage_api._normalized_import_row(
        {None: [], "name": "A", "unknown": "skip"},
        {"name": "name"},
        row_number=2,
        errors=errors,
    )
    assert row == {"name": "A"}
    assert errors and errors[0].field == "csv"


def test_normalized_import_row_ignores_unknown_headers() -> None:
    """Unknown CSV headers should be ignored without adding errors."""
    errors: list[coverage_api.CoverageTargetImportError] = []
    row = coverage_api._normalized_import_row(
        {"name": "A", "unknown": "skip"},
        {"name": "name"},
        row_number=2,
        errors=errors,
    )
    assert row == {"name": "A"}
    assert errors == []


def test_parse_import_row_skips_blank_rows_and_validates_required_columns() -> None:
    """Blank rows should be ignored while invalid rows should be rejected."""
    errors: list[coverage_api.CoverageTargetImportError] = []
    blank = coverage_api._parse_import_row(
        {
            "name": "",
            "geography": "",
            "issue_areas": "",
            "actor_types": "",
            "source_types": "",
        },
        row_number=2,
        errors=errors,
    )
    assert blank is None

    errors = []
    parsed = coverage_api._parse_import_row(
        {
            "name": "Kansas City tenant power",
            "geography": "Kansas City, MO",
            "issue_areas": "housing_affordability",
            "actor_types": "organization",
            "source_types": "community_archive",
            "linked_discovery_run_ids": "",
            "linked_entry_ids": "",
            "gaps": "",
            "next_actions": "",
            "last_reviewed_at": "",
            "review_state": "needs_research",
        },
        row_number=2,
        errors=errors,
    )
    assert parsed is not None
    assert parsed.request.name == "Kansas City tenant power"


def test_parse_import_row_rejects_bad_gap_rows() -> None:
    """Malformed gap rows should fail row parsing."""
    errors: list[coverage_api.CoverageTargetImportError] = []
    parsed = coverage_api._parse_import_row(
        {
            "name": "Kansas City tenant power",
            "geography": "Kansas City, MO",
            "issue_areas": "housing_affordability",
            "actor_types": "organization",
            "source_types": "community_archive",
            "linked_discovery_run_ids": "",
            "linked_entry_ids": "",
            "gaps": "Bad gap",
            "next_actions": "",
            "last_reviewed_at": "",
            "review_state": "needs_research",
        },
        row_number=2,
        errors=errors,
    )
    assert parsed is None
    assert errors[0].field == "gaps"


def test_parse_coverage_target_import_csv_requires_at_least_one_real_row() -> None:
    """A CSV with only a blank data row should report the user-facing row error."""
    csv_text = """name,geography,issue_areas,actor_types,source_types\n,,,,\n"""
    parsed_rows, errors = coverage_api._parse_coverage_target_import_csv(csv_text)
    assert parsed_rows == []
    assert errors[0].message == "At least one coverage target row is required."


def test_parse_coverage_target_import_csv_rejects_bad_headers() -> None:
    """Malformed headers should fail before any rows are parsed."""
    csv_text = """bogus,also_bad\nx,y\n"""
    parsed_rows, errors = coverage_api._parse_coverage_target_import_csv(csv_text)
    assert parsed_rows == []
    assert errors and errors[0].field == "bogus"


def test_parse_coverage_target_import_csv_reports_csv_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """CSV parser failures should surface a generic parse error."""

    class BrokenDictReader:
        fieldnames = ["name", "geography", "issue_areas", "actor_types", "source_types"]

        def __iter__(self) -> object:
            raise csv.Error("boom")

    monkeypatch.setattr(
        coverage_api.csv, "DictReader", lambda *_args, **_kwargs: BrokenDictReader()
    )

    parsed_rows, errors = coverage_api._parse_coverage_target_import_csv("unused")
    assert parsed_rows == []
    assert errors and errors[0].field == "csv"


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
