"""Pipeline completion helpers for the Scout runner."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from atlas_shared import DiscoveryRunArtifacts, DiscoveryRunStats

from atlas_scout.pipeline_artifacts import (
    build_run_artifacts,
    can_build_run_artifacts,
    save_ranked_entries,
)
from atlas_scout.pipeline_fetch_support import iter_items
from atlas_scout.pipeline_state import PipelineResult
from atlas_scout.steps.discovery_engine_adapters import deduplicate_stream

if TYPE_CHECKING:
    from atlas_scout.pipeline_state import PipelineState

logger = logging.getLogger("atlas_scout.pipeline_runtime")


async def finalize_pipeline(state: PipelineState) -> PipelineResult:
    """Deduplicate, rank, persist, and summarize a completed run."""
    from atlas_scout import pipeline as pipeline_public

    state.set_phase("finalizing")
    deduped_entries = [entry async for entry in deduplicate_stream(iter_items(state.raw_entries))]
    state.deduped_entries_count = len(deduped_entries)

    state.ranked_entries = [
        ranked
        async for ranked in pipeline_public.rank_entries_stream(
            iter_items(deduped_entries), min_score=state.min_entry_score
        )
    ]

    await save_ranked_entries(
        store=state.store,
        run_id=state.run_id,
        ranked_entries=state.ranked_entries,
    )

    gap_report = pipeline_public.analyze_gaps(state.location, state.ranked_entries)
    run_stats = DiscoveryRunStats(
        queries_generated=state.queries_count,
        sources_fetched=state.stats["pages_fetched"],
        sources_processed=state.stats["pages_fetched"],
        entries_extracted=len(state.raw_entries),
        entries_after_dedup=state.deduped_entries_count,
        entries_confirmed=len(state.ranked_entries),
    )
    artifacts: DiscoveryRunArtifacts | None = None
    if can_build_run_artifacts(location=state.location, state=state.state, issues=state.issues):
        artifacts = build_run_artifacts(
            run_id=state.run_id,
            location=state.location,
            state=state.state,
            issues=state.issues,
            search_depth=state.search_depth,
            started_at=state.started_at,
            completed_at=datetime.now(UTC),
            stats=run_stats,
            page_outcomes=state.page_outcomes_by_task,
            sources=list(state.fetched_pages_by_url.values()),
            raw_entries=state.raw_entries,
            ranked_entries=state.ranked_entries,
            gap_report=gap_report,
            remote_run_id=state.remote_run_id,
        )
        await state.store.save_run_artifacts(state.run_id, artifacts)

    contribution_result = None
    if state.contribution_config and state.contribution_config.enabled and artifacts is not None:
        from atlas_scout.steps.contribute import sync_run_artifacts

        state.set_phase("contributing")
        state.emit("status", {"phase": "contributing", "entries": len(state.ranked_entries)})
        await state.store.update_run_sync(state.run_id, sync_status="syncing")
        contribution_result = await sync_run_artifacts(
            artifacts,
            atlas_url=state.contribution_config.atlas_url,
            api_key=state.contribution_config.api_key,
        )
        if contribution_result.errors:
            artifacts = await state.store.update_run_sync(
                state.run_id,
                sync_status="failed",
                last_error="; ".join(contribution_result.errors),
            )
        else:
            artifacts = await state.store.update_run_sync(
                state.run_id,
                sync_status=contribution_result.sync_status or "synced",
                remote_run_id=contribution_result.run_id,
                synced_at=datetime.now(UTC),
            )
        state.emit(
            "status",
            {
                "phase": "contributed",
                "created": contribution_result.created,
                "failed": contribution_result.failed,
            },
        )
    elif state.contribution_config and state.contribution_config.enabled:
        logger.warning(
            "Skipping Atlas sync for run %s because canonical run metadata was not provided",
            state.run_id,
        )

    await state.store.complete_run(
        state.run_id,
        queries=state.queries_count,
        pages_fetched=state.stats["pages_fetched"],
        entries_found=len(state.raw_entries),
        entries_after_dedup=state.deduped_entries_count,
    )

    return PipelineResult(
        run_id=state.run_id,
        queries_generated=state.queries_count,
        pages_fetched=state.stats["pages_fetched"],
        entries_found=len(state.raw_entries),
        entries_after_dedup=state.deduped_entries_count,
        ranked_entries=state.ranked_entries,
        gap_report=gap_report,
        page_outcomes=list(state.page_outcomes_by_task.values()),
        artifacts=artifacts,
    )
