"""Run-completion artifact building and ranked-entry persistence."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas_shared import (
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoverySyncInfo,
    PageTaskOutcome,
    RunCheckpoint,
)

if TYPE_CHECKING:
    from datetime import datetime

    from atlas_shared import DiscoveryRunStats, GapReport, PageContent, RankedEntry, RawEntry

    from atlas_scout.store import ScoutStore


async def save_ranked_entries(
    *,
    store: ScoutStore,
    run_id: str,
    ranked_entries: list[RankedEntry],
) -> None:
    """Persist ranked entries through the store's batch path."""
    await store.bulk_save_entries(
        run_id=run_id,
        entries=[
            {
                "name": ranked.entry.name,
                "entry_type": str(ranked.entry.entry_type),
                "description": ranked.entry.description,
                "city": ranked.entry.city,
                "state": ranked.entry.state,
                "score": ranked.score,
                "data": ranked.entry.model_dump(mode="json"),
            }
            for ranked in ranked_entries
        ],
    )


def outcome_int(value: object) -> int:
    """Return an integer metric from a page outcome value."""
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return 0
    return 0


def build_run_artifacts(
    *,
    run_id: str,
    location: str,
    state: str,
    issues: list[str],
    search_depth: str,
    started_at: datetime,
    completed_at: datetime,
    stats: DiscoveryRunStats,
    page_outcomes: dict[str, dict[str, object]],
    sources: list[PageContent],
    raw_entries: list[RawEntry],
    ranked_entries: list[RankedEntry],
    gap_report: GapReport,
    remote_run_id: str | None = None,
) -> DiscoveryRunArtifacts:
    """Build the canonical run bundle emitted by the Scout runner."""
    return DiscoveryRunArtifacts(
        manifest=DiscoveryRunManifest(
            runner="atlas-scout",
            run=DiscoveryRunInput(
                location_query=location,
                state=state,
                issue_areas=issues,
                search_depth=search_depth,
            ),
            status=stats.status,
            started_at=started_at,
            completed_at=completed_at,
            sync=DiscoverySyncInfo(
                local_run_id=run_id,
                remote_run_id=remote_run_id,
                sync_status="ready",
            ),
        ),
        stats=stats,
        checkpoints=[
            RunCheckpoint(
                phase="completed",
                status=stats.status,
                metrics={
                    "queries_generated": stats.queries_generated,
                    "sources_fetched": stats.sources_fetched,
                    "entries_confirmed": stats.entries_confirmed,
                },
                created_at=completed_at,
            )
        ],
        page_tasks=[
            PageTaskOutcome(
                task_id=str(outcome.get("task_id") or ""),
                url=str(outcome.get("url") or ""),
                status=str(outcome.get("status") or "unknown"),
                depth=outcome_int(outcome.get("depth")),
                entries_extracted=outcome_int(outcome.get("entries")),
                error=str(outcome["error"]) if outcome.get("error") is not None else None,
                user_visible=bool(outcome.get("user_visible", False)),
            )
            for outcome in page_outcomes.values()
        ],
        sources=sources,
        raw_entries=raw_entries,
        ranked_entries=ranked_entries,
        gap_report=gap_report,
    )


def can_build_run_artifacts(*, location: str, state: str, issues: list[str]) -> bool:
    """Return whether the run has enough metadata to build a canonical sync bundle."""
    return bool(location.strip() and len(state.strip()) >= 2 and issues)
