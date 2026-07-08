"""Tests for coverage target import parsing helpers."""
# ruff: noqa

from __future__ import annotations

import csv
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery import api_org_coverage as coverage_api
from atlas.models import EntryCRUD


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
