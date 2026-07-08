"""Queue workers and frontier helpers for the Scout pipeline."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from atlas_shared import PageContent

from atlas_scout.pipeline_fetch_support import fetch_outcome, page_with_structured_columns
from atlas_scout.pipeline_state import _FrontierItem
from atlas_scout.pipeline_status import enqueue_extract_candidate
from atlas_scout.pipeline_support import (
    error_reason,
    merge_discovered_links,
    normalize_url,
    same_domain,
)
from atlas_scout.steps.entry_extract import extract_page_entries

if TYPE_CHECKING:
    from atlas_scout.pipeline_state import PipelineState

logger = logging.getLogger(__name__)


async def enqueue_url(
    state: PipelineState,
    url: str,
    *,
    depth: int,
    seed_url: str,
    discovered_from: str | None,
) -> bool:
    """Queue a normalized URL if it has not already been seen."""
    normalized = normalize_url(url)
    assert normalized, "enqueue_url callers must pre-normalize URLs"

    current_domain = discovered_from or seed_url
    assert not (discovered_from and not same_domain(current_domain, normalized)), (
        "enqueue_url callers must pre-check domain for discovered_from links"
    )

    async with state.frontier_lock:
        if normalized in state.seen_urls:
            return False
        seed_total = state.seed_counts.get(seed_url, 0)
        if seed_total >= state.max_pages_per_seed:
            return False
        state.seen_urls.add(normalized)
        state.seed_counts[seed_url] = seed_total + 1
        task_id = await state.store.create_page_task(state.run_id, normalized)
        state.page_outcomes_by_task[task_id] = {
            "task_id": task_id,
            "url": normalized,
            "depth": depth,
            "status": "queued",
            "error": None,
            "entries": 0,
            "user_visible": False,
        }
        is_root_candidate = depth == 0 and discovered_from is None
        if is_root_candidate:
            state.page_outcomes_by_task[task_id]["user_visible"] = True
            state.visible_page_tasks.add(task_id)

    await state.frontier_queue.put(
        _FrontierItem(
            url=normalized,
            depth=depth,
            seed_url=seed_url,
            task_id=task_id,
            discovered_from=discovered_from,
        )
    )
    state.emit(
        "frontier_queued",
        {
            "url": normalized,
            "depth": depth,
            "task_id": task_id,
            "frontier_queued": state.frontier_queue.qsize(),
            "seed_url": seed_url,
            "discovered_from": discovered_from,
        },
    )
    if depth == 0 and discovered_from is None:
        state.emit(
            "page_found",
            {
                "url": normalized,
                "depth": depth,
                "task_id": task_id,
            },
        )
    return True


async def fetch_worker(state: PipelineState) -> None:
    """Drain the frontier queue and turn URLs into fetched pages."""
    while True:
        item = await state.frontier_queue.get()
        if item is None:
            state.frontier_queue.task_done()
            return

        state.stats["fetch_active"] += 1
        try:
            await state.store.update_page_task(item.task_id, "fetching")
            state.page_outcomes_by_task[item.task_id]["status"] = "fetching"
            state.emit(
                "fetch_started",
                {
                    "url": item.url,
                    "depth": item.depth,
                    "task_id": item.task_id,
                },
            )

            outcome = await fetch_outcome(
                state.fetcher, url=item.url, task_id=item.task_id, store=state.store
            )
            discovered_links = merge_discovered_links(
                outcome.get("discovered_links"),
                outcome.get("page"),
            )
            page = outcome.get("page")
            error = outcome.get("error")
            fetch_status = str(outcome.get("status") or ("fetched" if page else "filtered"))

            if isinstance(page, PageContent):
                state.fetched_pages_by_url[page.url] = page
                page = page.model_copy(
                    update={
                        "task_id": item.task_id,
                        "discovered_links": discovered_links,
                    }
                )
                state.stats["pages_fetched"] += 1
                await enqueue_extract_candidate(
                    state,
                    page,
                    item=item,
                    discovered_links=discovered_links,
                )
                queued_links = 0
                if state.follow_links and discovered_links and item.depth < state.max_link_depth:
                    for link in discovered_links:
                        if same_domain(item.url, link):
                            queued = await enqueue_url(
                                state,
                                link,
                                depth=item.depth + 1,
                                seed_url=item.seed_url,
                                discovered_from=item.url,
                            )
                            if queued:
                                queued_links += 1

                state.page_outcomes_by_task[item.task_id].update(
                    status="fetched",
                    error=None,
                    discovered_links=discovered_links,
                )
                await state.store.update_page_task(item.task_id, "fetched")
                assert item.task_id in state.visible_page_tasks
                state.emit(
                    "page_fetched",
                    {
                        "url": item.url,
                        "depth": item.depth,
                        "task_id": item.task_id,
                        "links_found": len(discovered_links),
                        "links_queued": queued_links,
                    },
                )
                state.emit(
                    "fetch_completed",
                    {
                        "url": item.url,
                        "depth": item.depth,
                        "task_id": item.task_id,
                        "chars": len(page.text),
                        "discovered_links": len(discovered_links),
                        "queued_links": queued_links,
                    },
                )
            else:
                queued_links = 0
                if state.follow_links and discovered_links and item.depth < state.max_link_depth:
                    for link in discovered_links:
                        if same_domain(item.url, link):
                            queued = await enqueue_url(
                                state,
                                link,
                                depth=item.depth + 1,
                                seed_url=item.seed_url,
                                discovered_from=item.url,
                            )
                            if queued:
                                queued_links += 1
                skip_status = (
                    "filtered" if fetch_status in {"filtered", "skipped"} else fetch_status
                )
                state.page_outcomes_by_task[item.task_id].update(
                    status=skip_status,
                    error=error,
                    discovered_links=discovered_links,
                )
                await state.store.update_page_task(
                    item.task_id, skip_status, error=str(error) if error else None
                )
                state.emit(
                    "fetch_skipped",
                    {
                        "url": item.url,
                        "depth": item.depth,
                        "task_id": item.task_id,
                        "reason": error or skip_status,
                        "discovered_links": len(discovered_links),
                        "queued_links": queued_links,
                    },
                )
                if item.task_id in state.visible_page_tasks:
                    state.emit(
                        "page_skipped",
                        {
                            "url": item.url,
                            "depth": item.depth,
                            "task_id": item.task_id,
                            "reason": error or skip_status,
                        },
                    )
        except Exception as exc:
            logger.warning("Fetch failed for %s: %s", item.url, exc)
            state.page_outcomes_by_task[item.task_id].update(status="fetch_failed", error=str(exc))
            await state.store.update_page_task(item.task_id, "fetch_failed", error=str(exc))
            state.emit(
                "fetch_failed",
                {
                    "url": item.url,
                    "depth": item.depth,
                    "task_id": item.task_id,
                    "reason": str(exc),
                },
            )
            if item.task_id in state.visible_page_tasks:
                state.emit(
                    "page_failed",
                    {
                        "url": item.url,
                        "depth": item.depth,
                        "task_id": item.task_id,
                        "reason": str(exc),
                    },
                )
        finally:
            state.stats["fetch_active"] -= 1
            state.frontier_queue.task_done()


async def extract_worker(state: PipelineState) -> None:
    """Extract entities from fetched pages."""
    while True:
        _priority, _order, page = await state.extract_queue.get()
        if page is None:
            state.extract_queue.task_done()
            return

        assert page.task_id, "extract_worker requires a task_id on every queued page"
        task_id = page.task_id
        state.stats["extract_active"] += 1
        try:
            await state.store.update_page_task(task_id, "extracting")
            state.page_outcomes_by_task[task_id]["status"] = "extracting"
            state.emit(
                "extract_started",
                {
                    "url": page.url,
                    "task_id": task_id,
                    "extract_queued": state.extract_queue.qsize(),
                },
            )

            def emit_extract_retry(
                payload: dict[str, object], current_task_id: str = task_id
            ) -> None:
                state.emit(
                    "extract_retry",
                    {
                        **payload,
                        "task_id": current_task_id,
                    },
                )

            entries = await extract_page_entries(
                page_with_structured_columns(page, state.structured_columns),
                state.provider,
                state.city,
                state.state,
                store=state.store,
                run_id=state.run_id,
                reuse_cached_extractions=state.reuse_cached_extractions,
                extraction_directive=state.extraction_directive,
                on_retry=emit_extract_retry,
            )

            if entries:
                state.raw_entries.extend(entries)
                await state.store.update_page_task(
                    task_id, "extracted", entries_extracted=len(entries)
                )
                state.page_outcomes_by_task[task_id].update(
                    status="extracted", entries=len(entries)
                )
                state.emit(
                    "extract_completed",
                    {
                        "url": page.url,
                        "task_id": task_id,
                        "entries": len(entries),
                    },
                )
                for entry in entries:
                    state.emit(
                        "entity_found",
                        {
                            "url": page.url,
                            "task_id": task_id,
                            "name": entry.name,
                            "entry_type": str(entry.entry_type),
                        },
                    )
            else:
                await state.store.update_page_task(task_id, "extract_empty", entries_extracted=0)
                state.page_outcomes_by_task[task_id].update(status="extract_empty", entries=0)
                state.emit(
                    "extract_empty",
                    {
                        "url": page.url,
                        "task_id": task_id,
                    },
                )
                assert task_id in state.visible_page_tasks
                state.emit(
                    "page_skipped",
                    {
                        "url": page.url,
                        "task_id": task_id,
                        "depth": state.page_outcomes_by_task.get(task_id, {}).get("depth"),
                        "reason": "no_entities_found",
                    },
                )
        except Exception as exc:
            reason = error_reason(exc)
            logger.warning("Extraction failed for %s: %s", page.url, reason)
            await state.store.update_page_task(task_id, "extract_failed", error=reason)
            state.page_outcomes_by_task[task_id].update(status="extract_failed", error=reason)
            state.emit(
                "extract_failed",
                {
                    "url": page.url,
                    "task_id": task_id,
                    "reason": reason,
                },
            )
            assert task_id in state.visible_page_tasks
            state.emit(
                "page_failed",
                {
                    "url": page.url,
                    "task_id": task_id,
                    "depth": state.page_outcomes_by_task.get(task_id, {}).get("depth"),
                    "reason": reason,
                },
            )
        finally:
            state.stats["extract_active"] -= 1
            state.extract_queue.task_done()
