"""Coverage report and detail helpers for org coverage targets."""

from __future__ import annotations

import csv
import io
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.domains.discovery.models import DiscoveryRunCRUD

from .api_org_coverage_models import (
    COVERAGE_REPORT_CSV_COLUMNS,
    CoverageReportResponse,
    CoverageReportSummary,
    CoverageReportTarget,
    CoverageTargetDetailDiscoveryRun,
    CoverageTargetDetailEntry,
    CoverageTargetDetailResponse,
    CoverageTargetDetailSource,
    CoverageTargetGap,
    CoverageTargetResponse,
)

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.discovery.coverage_targets import CoverageTargetModel


def _target_response(target: CoverageTargetModel) -> CoverageTargetResponse:
    """Convert a coverage target model to its API response."""
    return CoverageTargetResponse(
        id=target.id,
        org_id=target.org_id,
        name=target.name,
        geography=target.geography,
        issue_areas=target.issue_areas,
        actor_types=target.actor_types,
        source_types=target.source_types,
        status=target.status,
        status_reason=target.status_reason,
        review_state=target.review_state,
        gaps=[CoverageTargetGap.model_validate(gap) for gap in target.gaps],
        next_actions=target.next_actions,
        records_found=target.records_found,
        sources_reviewed=target.sources_reviewed,
        linked_discovery_run_ids=target.linked_discovery_run_ids,
        linked_entry_ids=target.linked_entry_ids,
        last_run_at=target.last_run_at,
        last_reviewed_at=target.last_reviewed_at,
        created_by=target.created_by,
        created_at=target.created_at,
        updated_at=target.updated_at,
    )


def _detail_source(source: dict[str, object]) -> CoverageTargetDetailSource:
    """Convert a linked source row into a compact receipt."""
    return CoverageTargetDetailSource(
        id=str(source["id"]),
        url=str(source["url"]),
        title=str(source["title"]) if source.get("title") is not None else None,
        publication=str(source["publication"]) if source.get("publication") is not None else None,
        type=str(source["type"]),
    )


async def _detail_entry(
    db: aiosqlite.Connection,
    entry_id: str,
) -> CoverageTargetDetailEntry | None:
    """Load one linked coverage entry with compact source receipts."""
    entry, sources = await EntryCRUD.get_with_sources(db, entry_id)
    if entry is None:
        return None

    return CoverageTargetDetailEntry(
        id=entry.id,
        name=entry.name,
        type=entry.type,
        city=entry.city,
        state=entry.state,
        slug=entry.slug,
        source_count=len(sources),
        sources=[_detail_source(source) for source in sources],
    )


async def _target_detail_response(
    db: aiosqlite.Connection,
    target: CoverageTargetModel,
) -> CoverageTargetDetailResponse:
    """Build the detail payload that backs target review and follow-up research."""
    discovery_runs = [
        CoverageTargetDetailDiscoveryRun(
            id=run.id,
            location_query=run.location_query,
            state=run.state,
            research_goal=run.research_goal,
            issue_areas=run.issue_areas,
            status=run.status,
            entries_confirmed=run.entries_confirmed,
            sources_processed=run.sources_processed,
            started_at=run.started_at,
            completed_at=run.completed_at,
        )
        for run_id in target.linked_discovery_run_ids
        if (run := await DiscoveryRunCRUD.get_by_id(db, run_id)) is not None
    ]
    linked_entries = [
        entry
        for entry_id in target.linked_entry_ids
        if (entry := await _detail_entry(db, entry_id)) is not None
    ]
    return CoverageTargetDetailResponse(
        target=_target_response(target),
        discovery_runs=discovery_runs,
        entries=linked_entries,
    )


def _status_explanation(target: CoverageTargetModel) -> str:
    """Return plain report language for a derived coverage status."""
    if target.status == "covered":
        return "Current records and sources."
    if target.status == "thin":
        return "Fewer than 3 records or sources."
    if target.status == "stale":
        return "Not reviewed in 90 days."
    if target.status == "blocked":
        return "Latest review failed."
    return "No linked records yet."


def _report_target(target: CoverageTargetModel) -> CoverageReportTarget:
    """Convert a coverage target into a customer-facing report row."""
    return CoverageReportTarget(
        id=target.id,
        name=target.name,
        geography=target.geography,
        issue_areas=target.issue_areas,
        actor_types=target.actor_types,
        source_types=target.source_types,
        status=target.status,
        status_explanation=_status_explanation(target),
        review_state=target.review_state,
        gaps=[CoverageTargetGap.model_validate(gap) for gap in target.gaps],
        next_actions=target.next_actions,
        records_found=target.records_found,
        sources_reviewed=target.sources_reviewed,
        linked_discovery_run_ids=target.linked_discovery_run_ids,
        linked_entry_ids=target.linked_entry_ids,
        last_run_at=target.last_run_at,
        last_reviewed_at=target.last_reviewed_at,
        updated_at=target.updated_at,
    )


def build_coverage_report_response(
    *,
    org_id: str,
    targets: list[CoverageTargetModel],
) -> CoverageReportResponse:
    """Build a customer-facing JSON coverage report."""
    status_counts = {
        "blocked": 0,
        "covered": 0,
        "stale": 0,
        "thin": 0,
        "unknown": 0,
    }
    for target in targets:
        status_counts[target.status] += 1

    return CoverageReportResponse(
        format="json",
        generated_at=datetime.now(UTC).isoformat(),
        org_id=org_id,
        summary=CoverageReportSummary(
            total_targets=len(targets),
            covered=status_counts["covered"],
            thin=status_counts["thin"],
            unknown=status_counts["unknown"],
            stale=status_counts["stale"],
            blocked=status_counts["blocked"],
            needs_work=len(targets) - status_counts["covered"],
            records_found=sum(target.records_found for target in targets),
            sources_reviewed=sum(target.sources_reviewed for target in targets),
            open_gaps=sum(len(target.gaps) for target in targets),
            next_actions=sum(len(target.next_actions) for target in targets),
        ),
        targets=[_report_target(target) for target in targets],
    )


def _join_values(values: list[str]) -> str:
    """Return a semicolon-delimited CSV cell."""
    return ";".join(values)


def _gap_rows(gaps: list[CoverageTargetGap]) -> str:
    """Return compact gap labels and details for CSV export."""
    return ";".join(f"{gap.label}: {gap.detail}" for gap in gaps)


def _coverage_report_csv(report: CoverageReportResponse) -> str:
    """Serialize a coverage report as CSV rows."""
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=COVERAGE_REPORT_CSV_COLUMNS, lineterminator="\n")
    writer.writeheader()
    for target in report.targets:
        writer.writerow(
            {
                "target_id": target.id,
                "name": target.name,
                "geography": target.geography,
                "issue_areas": _join_values(target.issue_areas),
                "actor_types": _join_values(target.actor_types),
                "source_types": _join_values(target.source_types),
                "status": target.status,
                "status_explanation": target.status_explanation,
                "review_state": target.review_state,
                "records_found": target.records_found,
                "sources_reviewed": target.sources_reviewed,
                "linked_entry_ids": _join_values(target.linked_entry_ids),
                "linked_discovery_run_ids": _join_values(target.linked_discovery_run_ids),
                "gaps": _gap_rows(target.gaps),
                "next_actions": _join_values(target.next_actions),
                "last_run_at": target.last_run_at or "",
                "last_reviewed_at": target.last_reviewed_at or "",
                "updated_at": target.updated_at,
            }
        )
    return buffer.getvalue()
