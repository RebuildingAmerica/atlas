"""Coverage target CSV import helpers."""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.catalog.taxonomy import ALL_ISSUE_SLUGS

from .api_org_coverage_models import (
    COVERAGE_IMPORT_COLUMNS,
    COVERAGE_IMPORT_REQUIRED_COLUMNS,
    CoverageTargetCreateRequest,
    CoverageTargetGap,
    CoverageTargetImportError,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

    import aiosqlite


@dataclass(slots=True)
class ParsedCoverageTargetImportRow:
    """Parsed CSV row ready for link validation and creation."""

    row_number: int
    request: CoverageTargetCreateRequest


def _normalize_import_header(value: str) -> str:
    """Normalize a CSV header from a customer onboarding spreadsheet."""
    return value.strip().removeprefix("\ufeff")


def _split_import_cell(value: str | None) -> list[str]:
    """Split semicolon-delimited cell values while dropping blank fragments."""
    if value is None:
        return []
    return [item.strip() for item in value.split(";") if item.strip()]


def _import_cell(row: dict[str, str | None], field: str) -> str:
    """Return a normalized import cell."""
    return (row.get(field) or "").strip()


def _parse_import_review_state(
    value: str,
    *,
    row_number: int,
    errors: list[CoverageTargetImportError],
) -> Literal["needs_research", "in_review", "ready_for_delivery"]:
    """Return a validated coverage review state for an import row."""
    if not value or value == "needs_research":
        return "needs_research"
    if value == "in_review":
        return "in_review"
    if value == "ready_for_delivery":
        return "ready_for_delivery"

    errors.append(
        CoverageTargetImportError(
            row=row_number,
            field="review_state",
            message="Review state must be needs_research, in_review, or ready_for_delivery.",
        )
    )
    return "needs_research"


def _parse_import_gaps(
    value: str,
    *,
    row_number: int,
    errors: list[CoverageTargetImportError],
) -> list[CoverageTargetGap]:
    """Parse semicolon-delimited gap labels and details from one CSV cell."""
    gaps: list[CoverageTargetGap] = []
    for gap in _split_import_cell(value):
        label, separator, detail = gap.partition(":")
        if not separator or not label.strip() or not detail.strip():
            errors.append(
                CoverageTargetImportError(
                    row=row_number,
                    field="gaps",
                    message="Gaps must use 'Label: detail' entries separated by semicolons.",
                )
            )
            continue
        gaps.append(CoverageTargetGap(label=label.strip(), detail=detail.strip()))
    return gaps


def _validate_import_headers(
    fieldnames: Sequence[str] | None,
) -> tuple[dict[str, str], list[CoverageTargetImportError]]:
    """Validate and map CSV headers to their normalized field names."""
    if fieldnames is None:
        return {}, [
            CoverageTargetImportError(
                row=1,
                field="csv",
                message="CSV header row is required.",
            )
        ]

    header_map: dict[str, str] = {}
    errors: list[CoverageTargetImportError] = []
    normalized_headers = [_normalize_import_header(fieldname) for fieldname in fieldnames]
    for raw_header, normalized in zip(fieldnames, normalized_headers, strict=False):
        if not normalized:
            errors.append(
                CoverageTargetImportError(
                    row=1,
                    field="csv",
                    message="CSV column names cannot be blank.",
                )
            )
            continue
        if normalized not in COVERAGE_IMPORT_COLUMNS:
            errors.append(
                CoverageTargetImportError(
                    row=1,
                    field=normalized,
                    message="Unknown coverage import column.",
                )
            )
            continue
        if normalized in header_map.values():
            errors.append(
                CoverageTargetImportError(
                    row=1,
                    field=normalized,
                    message="Duplicate coverage import column.",
                )
            )
            continue
        header_map[raw_header] = normalized

    errors.extend(
        CoverageTargetImportError(
            row=1,
            field=required_column,
            message="Missing required coverage import column.",
        )
        for required_column in sorted(COVERAGE_IMPORT_REQUIRED_COLUMNS)
        if required_column not in normalized_headers
    )

    return header_map, errors


def _required_import_row_errors(
    row: dict[str, str | None],
    *,
    row_number: int,
) -> list[CoverageTargetImportError]:
    """Return missing-value errors for one import row."""
    return [
        CoverageTargetImportError(
            row=row_number,
            field=required_field,
            message="Required value is missing.",
        )
        for required_field in sorted(COVERAGE_IMPORT_REQUIRED_COLUMNS)
        if not _import_cell(row, required_field)
    ]


def _issue_area_import_row_errors(
    issue_areas: list[str],
    *,
    row_number: int,
) -> list[CoverageTargetImportError]:
    """Return invalid issue area errors for one import row."""
    return [
        CoverageTargetImportError(
            row=row_number,
            field="issue_areas",
            message=f"Invalid issue area: {issue_area}",
        )
        for issue_area in issue_areas
        if issue_area not in ALL_ISSUE_SLUGS
    ]


def _normalized_import_row(
    raw_row: dict[str | None, str | list[str] | None],
    header_map: dict[str, str],
    *,
    row_number: int,
    errors: list[CoverageTargetImportError],
) -> dict[str, str | None]:
    """Normalize one CSV row to known coverage import field names."""
    if None in raw_row:
        errors.append(
            CoverageTargetImportError(
                row=row_number,
                field="csv",
                message="Row has more values than the header row.",
            )
        )
    normalized: dict[str, str | None] = {}
    for raw_header, value in raw_row.items():
        if raw_header is None:
            continue
        normalized_header = header_map.get(raw_header)
        if normalized_header is None:
            continue
        normalized[normalized_header] = value if isinstance(value, str) else None
    return normalized


def _parse_import_row(
    row: dict[str, str | None],
    *,
    row_number: int,
    errors: list[CoverageTargetImportError],
) -> ParsedCoverageTargetImportRow | None:
    """Parse one normalized CSV row into a coverage target request."""
    if all(not (value or "").strip() for value in row.values()):
        return None

    row_error_count = len(errors)
    errors.extend(_required_import_row_errors(row, row_number=row_number))

    issue_areas = _split_import_cell(_import_cell(row, "issue_areas"))
    errors.extend(_issue_area_import_row_errors(issue_areas, row_number=row_number))

    actor_types = _split_import_cell(_import_cell(row, "actor_types"))
    source_types = _split_import_cell(_import_cell(row, "source_types"))
    if len(errors) > row_error_count or not issue_areas or not actor_types or not source_types:
        return None

    review_state = _parse_import_review_state(
        _import_cell(row, "review_state"),
        row_number=row_number,
        errors=errors,
    )
    gaps = _parse_import_gaps(_import_cell(row, "gaps"), row_number=row_number, errors=errors)
    if len(errors) > row_error_count:
        return None

    return ParsedCoverageTargetImportRow(
        row_number=row_number,
        request=CoverageTargetCreateRequest(
            name=_import_cell(row, "name"),
            geography=_import_cell(row, "geography"),
            issue_areas=issue_areas,
            actor_types=actor_types,
            source_types=source_types,
            linked_discovery_run_ids=_split_import_cell(
                _import_cell(row, "linked_discovery_run_ids")
            ),
            linked_entry_ids=_split_import_cell(_import_cell(row, "linked_entry_ids")),
            gaps=gaps,
            next_actions=_split_import_cell(_import_cell(row, "next_actions")),
            last_reviewed_at=_import_cell(row, "last_reviewed_at") or None,
            review_state=review_state,
        ),
    )


def _parse_coverage_target_import_csv(
    csv_text: str,
) -> tuple[list[ParsedCoverageTargetImportRow], list[CoverageTargetImportError]]:
    """Parse a CSV payload into coverage target create requests."""
    reader = csv.DictReader(io.StringIO(csv_text), skipinitialspace=True)
    header_map, errors = _validate_import_headers(reader.fieldnames)
    if errors:
        return [], errors

    parsed_rows: list[ParsedCoverageTargetImportRow] = []
    try:
        for row_number, raw_row in enumerate(reader, start=2):
            normalized = _normalized_import_row(
                raw_row,
                header_map,
                row_number=row_number,
                errors=errors,
            )
            parsed = _parse_import_row(normalized, row_number=row_number, errors=errors)
            if parsed is not None:
                parsed_rows.append(parsed)
    except csv.Error as exc:
        errors.append(
            CoverageTargetImportError(row=1, field="csv", message=f"CSV could not be parsed: {exc}")
        )

    if not parsed_rows and not errors:
        errors.append(
            CoverageTargetImportError(
                row=1,
                field="csv",
                message="At least one coverage target row is required.",
            )
        )

    return parsed_rows, errors


async def _validate_import_target_links(
    db: aiosqlite.Connection,
    *,
    org_id: str,
    parsed_rows: list[ParsedCoverageTargetImportRow],
) -> list[CoverageTargetImportError]:
    """Validate imported link references before any target is created."""
    errors: list[CoverageTargetImportError] = []
    for parsed_row in parsed_rows:
        req = parsed_row.request
        for run_id in req.linked_discovery_run_ids:
            ownership = await OwnershipCRUD.get_ownership(db, run_id, "discovery_run")
            if ownership is None or ownership.org_id != org_id:
                errors.append(
                    CoverageTargetImportError(
                        row=parsed_row.row_number,
                        field="linked_discovery_run_ids",
                        message=f"Discovery run not found: {run_id}",
                    )
                )

        for entry_id in req.linked_entry_ids:
            entry = await EntryCRUD.get_by_id(db, entry_id)
            if entry is None:
                errors.append(
                    CoverageTargetImportError(
                        row=parsed_row.row_number,
                        field="linked_entry_ids",
                        message=f"Entry not found: {entry_id}",
                    )
                )
    return errors


def _coverage_import_error_detail(
    errors: list[CoverageTargetImportError],
) -> dict[str, object]:
    """Return a stable error shape for coverage target import failures."""
    return {
        "message": "Coverage import failed.",
        "errors": [error.model_dump() for error in errors],
    }
