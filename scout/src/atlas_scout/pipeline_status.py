"""Periodic status reporting for the Scout pipeline."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from atlas_shared import PageContent  # noqa: TC002

from atlas_scout.pipeline_support import decide_extraction_admission

if TYPE_CHECKING:
    from atlas_scout.pipeline_state import PipelineState, _FrontierItem


async def status_reporter(state: PipelineState) -> None:
    """Emit progress snapshots until the run stops."""
    while not state.status_stop.is_set():
        state.emit(
            "status",
            {
                "phase": state.phase["value"],
                "frontier_queued": state.frontier_queue.qsize(),
                "extract_queued": state.extract_queue.qsize(),
                "fetch_active": state.stats["fetch_active"],
                "extract_active": state.stats["extract_active"],
                "entries_found": len(state.raw_entries),
            },
        )
        try:
            await asyncio.wait_for(state.status_stop.wait(), timeout=0.5)
        except TimeoutError:
            continue


async def enqueue_extract_candidate(
    state: PipelineState,
    page: PageContent,
    *,
    item: _FrontierItem,
    discovered_links: list[str],
) -> bool:
    """Queue a fetched page for extraction."""
    admission = decide_extraction_admission(
        page=page,
        depth=item.depth,
    )
    assert admission.should_extract, (
        "extract admission must yield a priority for every fetched page"
    )

    if item.task_id not in state.visible_page_tasks:
        state.visible_page_tasks.add(item.task_id)
        state.page_outcomes_by_task[item.task_id]["user_visible"] = True
        state.emit(
            "page_found",
            {
                "url": item.url,
                "depth": item.depth,
                "task_id": item.task_id,
                "links_found": len(discovered_links),
            },
        )

    state.extract_order += 1
    assert admission.priority is not None
    await state.extract_queue.put((admission.priority, state.extract_order, page))
    return True
