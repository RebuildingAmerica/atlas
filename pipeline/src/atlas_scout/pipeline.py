"""Concurrency-native Scout pipeline with tracked page tasks and progress events."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from atlas_shared import GapReport, PageContent, RankedEntry, RawEntry

from atlas_scout.pipeline_support import (
    decide_extraction_admission,
    error_reason,
    extract_worker_count,
    merge_discovered_links,
    normalize_url,
    parse_location,
    same_domain,
)
from atlas_scout.steps import source_fetch
from atlas_scout.steps.dedup import deduplicate_stream
from atlas_scout.steps.entry_extract import extract_page_entries
from atlas_scout.steps.gap_analysis import analyze_gaps
from atlas_scout.steps.query_gen import generate_queries
from atlas_scout.steps.rank import rank_entries_stream
from atlas_scout.steps.source_fetch import results_per_query_for_depth

if TYPE_CHECKING:
    from collections.abc import Callable

    from atlas_scout.config import ContributionConfig
    from atlas_scout.providers.base import LLMProvider
    from atlas_scout.scraper.fetcher import AsyncFetcher
    from atlas_scout.store import ScoutStore

logger = logging.getLogger(__name__)

_STATUS_INTERVAL_SECONDS = 0.5

__all__ = ["_STATUS_INTERVAL_SECONDS", "PipelineResult", "_parse_location", "run_pipeline"]


@dataclass(slots=True)
class PipelineResult:
    """Summary of a completed discovery pipeline run."""

    run_id: str
    queries_generated: int
    pages_fetched: int
    entries_found: int
    entries_after_dedup: int
    ranked_entries: list[RankedEntry]
    gap_report: GapReport
    page_outcomes: list[dict[str, object]] = field(default_factory=list)


@dataclass(slots=True)
class _FrontierItem:
    url: str
    depth: int
    seed_url: str
    task_id: str
    discovered_from: str | None = None


async def run_pipeline(
    *,
    location: str,
    issues: list[str],
    provider: LLMProvider,
    store: ScoutStore,
    search_api_key: str = "",
    search_depth: str = "standard",
    min_entry_score: float = 0.3,
    reuse_cached_extractions: bool = True,
    fetcher: AsyncFetcher | None = None,
    direct_urls: list[str] | None = None,
    on_progress: Callable[[str, dict[str, object]], None] | None = None,
    extraction_directive: str | None = None,
    search_concurrency: int | None = None,
    follow_links: bool = True,
    max_link_depth: int = 2,
    max_pages_per_seed: int = 20,
    iterative_deepening: bool = False,
    contribution_config: ContributionConfig | None = None,
) -> PipelineResult:
    """Run Scout discovery in search mode or direct-URL mode."""
    from atlas_scout.scraper.fetcher import AsyncFetcher as DefaultFetcher

    city, state = parse_location(location)
    run_id = await store.create_run(location=location, issues=issues, search_depth=search_depth)
    await store.update_run_status(run_id, "running")

    own_fetcher = fetcher is None
    fetcher = fetcher or DefaultFetcher(store=store, run_id=run_id)
    bind_run = getattr(fetcher, "bind_run", None)
    if callable(bind_run):
        maybe = bind_run(run_id)
        if asyncio.iscoroutine(maybe):
            await maybe

    frontier_queue: asyncio.Queue[_FrontierItem | None] = asyncio.Queue()
    extract_queue: asyncio.PriorityQueue[tuple[int, int, PageContent | None]] = asyncio.PriorityQueue()
    frontier_lock = asyncio.Lock()

    queries_count = 0
    raw_entries: list[RawEntry] = []
    ranked_entries: list[RankedEntry] = []
    deduped_entries_count = 0
    seen_urls: set[str] = set()
    seed_counts: dict[str, int] = {}
    page_outcomes_by_task: dict[str, dict[str, object]] = {}
    visible_page_tasks: set[str] = set()
    extract_order = 0
    stats = {
        "fetch_active": 0,
        "extract_active": 0,
        "pages_fetched": 0,
    }
    phase = {"value": "starting"}
    status_stop = asyncio.Event()

    def emit(event: str, payload: dict[str, object]) -> None:
        if on_progress is None:
            return
        try:
            on_progress(event, payload)
        except Exception:
            logger.debug("Progress callback failed for event %s", event, exc_info=True)

    async def enqueue_url(
        url: str,
        *,
        depth: int,
        seed_url: str,
        discovered_from: str | None,
    ) -> bool:
        normalized = normalize_url(url)
        if not normalized:
            return False

        current_domain = discovered_from or seed_url
        if discovered_from and not same_domain(current_domain, normalized):
            return False

        async with frontier_lock:
            if normalized in seen_urls:
                return False
            seed_total = seed_counts.get(seed_url, 0)
            if seed_total >= max_pages_per_seed:
                return False
            seen_urls.add(normalized)
            seed_counts[seed_url] = seed_total + 1
            task_id = await store.create_page_task(run_id, normalized)
            page_outcomes_by_task[task_id] = {
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
                page_outcomes_by_task[task_id]["user_visible"] = True
                visible_page_tasks.add(task_id)

        await frontier_queue.put(
            _FrontierItem(
                url=normalized,
                depth=depth,
                seed_url=seed_url,
                task_id=task_id,
                discovered_from=discovered_from,
            )
        )
        emit(
            "frontier_queued",
            {
                "url": normalized,
                "depth": depth,
                "task_id": task_id,
                "frontier_queued": frontier_queue.qsize(),
                "seed_url": seed_url,
                "discovered_from": discovered_from,
            },
        )
        if depth == 0 and discovered_from is None:
            emit(
                "page_found",
                {
                    "url": normalized,
                    "depth": depth,
                    "task_id": task_id,
                },
            )
        return True

    async def status_reporter() -> None:
        while not status_stop.is_set():
            emit(
                "status",
                {
                    "phase": phase["value"],
                    "frontier_queued": frontier_queue.qsize(),
                    "extract_queued": extract_queue.qsize(),
                    "fetch_active": stats["fetch_active"],
                    "extract_active": stats["extract_active"],
                    "entries_found": len(raw_entries),
                },
            )
            try:
                await asyncio.wait_for(status_stop.wait(), timeout=_STATUS_INTERVAL_SECONDS)
            except TimeoutError:
                continue

    async def enqueue_extract_candidate(
        page: PageContent,
        *,
        item: _FrontierItem,
        discovered_links: list[str],
    ) -> bool:
        nonlocal extract_order
        admission = decide_extraction_admission(
            page=page,
            depth=item.depth,
        )
        if not admission.should_extract:
            page_outcomes_by_task[item.task_id].update(status="filtered", error=admission.skip_reason)
            await store.update_page_task(item.task_id, "filtered", error=admission.skip_reason)
            emit(
                "fetch_skipped",
                {
                    "url": item.url,
                    "depth": item.depth,
                    "task_id": item.task_id,
                    "reason": admission.skip_reason,
                    "discovered_links": len(discovered_links),
                },
            )
            if item.task_id in visible_page_tasks:
                emit(
                    "page_skipped",
                    {
                        "url": item.url,
                        "depth": item.depth,
                        "task_id": item.task_id,
                        "reason": admission.skip_reason,
                    },
                )
            return False

        if item.task_id not in visible_page_tasks:
            visible_page_tasks.add(item.task_id)
            page_outcomes_by_task[item.task_id]["user_visible"] = True
            emit(
                "page_found",
                {
                    "url": item.url,
                    "depth": item.depth,
                    "task_id": item.task_id,
                    "links_found": len(discovered_links),
                },
            )

        extract_order += 1
        await extract_queue.put((admission.priority or 0, extract_order, page))
        return True

    async def fetch_worker() -> None:
        while True:
            item = await frontier_queue.get()
            if item is None:
                return

            stats["fetch_active"] += 1
            try:
                await store.update_page_task(item.task_id, "fetching")
                page_outcomes_by_task[item.task_id]["status"] = "fetching"
                emit(
                    "fetch_started",
                    {
                        "url": item.url,
                        "depth": item.depth,
                        "task_id": item.task_id,
                    },
                )

                outcome = await _fetch_outcome(fetcher, item, store)
                discovered_links = merge_discovered_links(
                    outcome.get("discovered_links"),
                    outcome.get("page"),
                )
                page = outcome.get("page")
                error = outcome.get("error")
                fetch_status = str(outcome.get("status") or ("fetched" if page else "filtered"))

                if isinstance(page, PageContent):
                    page = page.model_copy(
                        update={
                            "task_id": item.task_id,
                            "discovered_links": discovered_links,
                        }
                    )
                    stats["pages_fetched"] += 1
                    admitted_to_extract = await enqueue_extract_candidate(
                        page,
                        item=item,
                        discovered_links=discovered_links,
                    )
                    queued_links = 0
                    if follow_links and discovered_links and item.depth < max_link_depth:
                        for link in discovered_links:
                            if same_domain(item.url, link):
                                queued = await enqueue_url(
                                    link,
                                    depth=item.depth + 1,
                                    seed_url=item.seed_url,
                                    discovered_from=item.url,
                                )
                                if queued:
                                    queued_links += 1

                    if admitted_to_extract:
                        page_outcomes_by_task[item.task_id].update(
                            status="fetched",
                            error=None,
                            discovered_links=discovered_links,
                        )
                        await store.update_page_task(item.task_id, "fetched")
                        if item.task_id in visible_page_tasks:
                            emit(
                                "page_fetched",
                                {
                                    "url": item.url,
                                    "depth": item.depth,
                                    "task_id": item.task_id,
                                    "links_found": len(discovered_links),
                                    "links_queued": queued_links,
                                },
                            )
                        emit(
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
                    if follow_links and discovered_links and item.depth < max_link_depth:
                        for link in discovered_links:
                            if same_domain(item.url, link):
                                queued = await enqueue_url(
                                    link,
                                    depth=item.depth + 1,
                                    seed_url=item.seed_url,
                                    discovered_from=item.url,
                                )
                                if queued:
                                    queued_links += 1
                    skip_status = "filtered" if fetch_status in {"filtered", "skipped"} else fetch_status
                    page_outcomes_by_task[item.task_id].update(
                        status=skip_status,
                        error=error,
                        discovered_links=discovered_links,
                    )
                    await store.update_page_task(item.task_id, skip_status, error=str(error) if error else None)
                    emit(
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
                    if item.task_id in visible_page_tasks:
                        emit(
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
                page_outcomes_by_task[item.task_id].update(status="fetch_failed", error=str(exc))
                await store.update_page_task(item.task_id, "fetch_failed", error=str(exc))
                emit(
                    "fetch_failed",
                    {
                        "url": item.url,
                        "depth": item.depth,
                        "task_id": item.task_id,
                        "reason": str(exc),
                    },
                )
                if item.task_id in visible_page_tasks:
                    emit(
                        "page_failed",
                        {
                            "url": item.url,
                            "depth": item.depth,
                            "task_id": item.task_id,
                            "reason": str(exc),
                        },
                    )
            finally:
                stats["fetch_active"] -= 1
                frontier_queue.task_done()

    async def extract_worker() -> None:
        while True:
            _priority, _order, page = await extract_queue.get()
            if page is None:
                return

            task_id = page.task_id or ""
            stats["extract_active"] += 1
            try:
                if task_id:
                    await store.update_page_task(task_id, "extracting")
                    page_outcomes_by_task[task_id]["status"] = "extracting"
                emit(
                    "extract_started",
                    {
                        "url": page.url,
                        "task_id": task_id,
                        "extract_queued": extract_queue.qsize(),
                    },
                )

                entries = await extract_page_entries(
                    page,
                    provider,
                    city,
                    state,
                    store=store,
                    run_id=run_id,
                    reuse_cached_extractions=reuse_cached_extractions,
                    extraction_directive=extraction_directive,
                    on_retry=lambda payload, current_task_id=task_id: emit(
                        "extract_retry",
                        {
                            **payload,
                            "task_id": current_task_id,
                        },
                    ),
                )

                if entries:
                    raw_entries.extend(entries)
                    if task_id:
                        await store.update_page_task(task_id, "extracted", entries_extracted=len(entries))
                        page_outcomes_by_task[task_id].update(status="extracted", entries=len(entries))
                    emit(
                        "extract_completed",
                        {
                            "url": page.url,
                            "task_id": task_id,
                            "entries": len(entries),
                        },
                    )
                    for entry in entries:
                        emit(
                            "entity_found",
                            {
                                "url": page.url,
                                "task_id": task_id,
                                "name": entry.name,
                                "entry_type": str(entry.entry_type),
                            },
                        )
                else:
                    if task_id:
                        await store.update_page_task(task_id, "extract_empty", entries_extracted=0)
                        page_outcomes_by_task[task_id].update(status="extract_empty", entries=0)
                    emit(
                        "extract_empty",
                        {
                            "url": page.url,
                            "task_id": task_id,
                        },
                    )
                    if task_id in visible_page_tasks:
                        emit(
                            "page_skipped",
                            {
                                "url": page.url,
                                "task_id": task_id,
                                "depth": page_outcomes_by_task.get(task_id, {}).get("depth"),
                                "reason": "no_entities_found",
                            },
                        )
            except Exception as exc:
                reason = error_reason(exc)
                logger.warning("Extraction failed for %s: %s", page.url, reason)
                if task_id:
                    await store.update_page_task(task_id, "extract_failed", error=reason)
                    page_outcomes_by_task[task_id].update(status="extract_failed", error=reason)
                emit(
                    "extract_failed",
                    {
                        "url": page.url,
                        "task_id": task_id,
                        "reason": reason,
                    },
                )
                if task_id in visible_page_tasks:
                    emit(
                        "page_failed",
                        {
                            "url": page.url,
                            "task_id": task_id,
                            "depth": page_outcomes_by_task.get(task_id, {}).get("depth"),
                            "reason": reason,
                        },
                    )
            finally:
                stats["extract_active"] -= 1
                extract_queue.task_done()

    status_task: asyncio.Task[None] | None = None
    fetch_workers: list[asyncio.Task[None]] = []
    extract_workers: list[asyncio.Task[None]] = []

    try:
        status_task = asyncio.create_task(status_reporter())
        fetch_worker_count = max(
            1,
            int(getattr(fetcher, "max_concurrent", 8) or 8),
        )
        fetch_workers = [
            asyncio.create_task(fetch_worker())
            for _ in range(fetch_worker_count)
        ]
        extract_workers = [
            asyncio.create_task(extract_worker())
            for _ in range(extract_worker_count(provider, direct_mode=bool(direct_urls)))
        ]

        phase["value"] = "building_frontier"
        if direct_urls:
            for url in direct_urls:
                normalized = normalize_url(url)
                if normalized:
                    await enqueue_url(normalized, depth=0, seed_url=normalized, discovered_from=None)
        else:
            queries = generate_queries(city=city, state=state, issue_areas=issues)
            queries_count = len(queries)
            if not search_api_key:
                raise ValueError("search_api_key is required in search mode")
            await _produce_search_frontier(
                queries=[query.query for query in queries],
                search_api_key=search_api_key,
                enqueue=enqueue_url,
                max_concurrent=search_concurrency or 8,
                results_per_query=results_per_query_for_depth(search_depth),
            )

        emit(
            "status",
            {
                "phase": phase["value"],
                "frontier_queued": frontier_queue.qsize(),
                "extract_queued": extract_queue.qsize(),
                "fetch_active": stats["fetch_active"],
                "extract_active": stats["extract_active"],
                "entries_found": len(raw_entries),
            },
        )

        phase["value"] = "draining_fetch"
        await frontier_queue.join()
        for _ in fetch_workers:
            await frontier_queue.put(None)
        await asyncio.gather(*fetch_workers)

        phase["value"] = "draining_extract"
        await extract_queue.join()
        for idx, _worker in enumerate(extract_workers, start=1):
            await extract_queue.put((10**9, idx, None))
        await asyncio.gather(*extract_workers)

        # --- AI-native deepening: LLM-driven queries + entity chasing + lead following ---
        if iterative_deepening and not direct_urls:
            from atlas_scout.scraper.browser_researcher import research_org_website
            from atlas_scout.steps.entity_chase import (
                generate_followup_queries,
                select_entities_to_chase,
            )

            phase["value"] = "deepening"
            preliminary_deduped = [
                entry async for entry in deduplicate_stream(_iter_items(raw_entries))
            ]
            preliminary_ranked = [
                r async for r in rank_entries_stream(
                    _iter_items(preliminary_deduped), min_score=min_entry_score
                )
            ]
            preliminary_gaps = analyze_gaps(location, preliminary_ranked)

            # --- 1. Follow discovery leads from extraction ---
            all_leads: list[str] = []
            for entry in raw_entries:
                for lead in getattr(entry, "discovery_leads", []):
                    normalized = normalize_url(lead)
                    if normalized and normalized not in seen_urls:
                        seen_urls.add(normalized)
                        all_leads.append(normalized)

            if all_leads:
                emit("status", {"phase": "following_leads", "lead_count": len(all_leads)})
                for url in all_leads[:50]:  # cap at 50 leads
                    page = await fetcher.fetch(url)
                    if page is None:
                        continue
                    stats["pages_fetched"] += 1
                    entries = await extract_page_entries(
                        page, provider, city, state,
                        store=store, run_id=run_id,
                        reuse_cached_extractions=reuse_cached_extractions,
                        extraction_directive=extraction_directive,
                    )
                    if entries:
                        raw_entries.extend(entries)

            # --- 2. LLM-driven follow-up queries ---
            if search_api_key:
                emit("status", {"phase": "llm_query_gen"})
                followup_queries = await generate_followup_queries(
                    provider,
                    location=location,
                    issues=issues,
                    gap_report=preliminary_gaps,
                    existing_entries=preliminary_ranked,
                )
                if followup_queries:
                    queries_count += len(followup_queries)
                    emit("status", {
                        "phase": "deepening_search",
                        "followup_queries": len(followup_queries),
                    })
                    deeper_rpq = results_per_query_for_depth("deep")
                    deeper_results = await source_fetch._search_brave(
                        [q.query for q in followup_queries],
                        search_api_key,
                        results_per_query=deeper_rpq,
                    )
                    for result in deeper_results:
                        url = result.get("url")
                        if isinstance(url, str) and url:
                            normalized = normalize_url(url)
                            if normalized and normalized not in seen_urls:
                                seen_urls.add(normalized)
                                page = await fetcher.fetch(normalized)
                                if page is None:
                                    continue
                                stats["pages_fetched"] += 1
                                entries = await extract_page_entries(
                                    page, provider, city, state,
                                    store=store, run_id=run_id,
                                    reuse_cached_extractions=reuse_cached_extractions,
                                    extraction_directive=extraction_directive,
                                )
                                if entries:
                                    raw_entries.extend(entries)

            # --- 3. Entity chasing: fetch org websites for staff/board/partners ---
            emit("status", {"phase": "entity_chasing"})
            # Re-rank with new entries before chasing
            chase_deduped = [
                entry async for entry in deduplicate_stream(_iter_items(raw_entries))
            ]
            chase_ranked = [
                r async for r in rank_entries_stream(
                    _iter_items(chase_deduped), min_score=min_entry_score
                )
            ]
            chase_targets = await select_entities_to_chase(
                provider,
                entries=chase_ranked,
            )
            for target in chase_targets:
                target_url = target.get("website", "")
                if target_url:
                    normalized = normalize_url(target_url)
                    if normalized and normalized not in seen_urls:
                        seen_urls.add(normalized)
                        page = await fetcher.fetch(normalized)
                        if page is not None:
                            stats["pages_fetched"] += 1
                            entries = await extract_page_entries(
                                page, provider, city, state,
                                store=store, run_id=run_id,
                                reuse_cached_extractions=reuse_cached_extractions,
                                extraction_directive=extraction_directive,
                            )
                            if entries:
                                raw_entries.extend(entries)

                # Also search for the entity if we have a query
                search_query = target.get("search_query", "")
                if search_query and search_api_key:
                    chase_results = await source_fetch._search_brave(
                        [search_query], search_api_key, results_per_query=5,
                    )
                    for result in chase_results:
                        url = result.get("url")
                        if isinstance(url, str) and url:
                            normalized = normalize_url(url)
                            if normalized and normalized not in seen_urls:
                                seen_urls.add(normalized)
                                page = await fetcher.fetch(normalized)
                                if page is not None:
                                    stats["pages_fetched"] += 1
                                    entries = await extract_page_entries(
                                        page, provider, city, state,
                                        store=store, run_id=run_id,
                                        reuse_cached_extractions=reuse_cached_extractions,
                                        extraction_directive=extraction_directive,
                                    )
                                    if entries:
                                        raw_entries.extend(entries)

            # --- 4. Browser research: deep-dive into top org websites ---
            browser_targets = [
                t for t in chase_targets
                if t.get("website") and normalize_url(t["website"])
            ][:5]  # Top 5 orgs only
            if browser_targets:
                emit("status", {"phase": "browser_research", "targets": len(browser_targets)})
                for target in browser_targets:
                    target_url = target["website"]
                    org_name = target.get("name", "")
                    browser_entries = await research_org_website(
                        target_url,
                        provider=provider,
                        city=city,
                        state=state,
                        org_name=org_name,
                    )
                    if browser_entries:
                        raw_entries.extend(browser_entries)
                        emit("status", {
                            "phase": "browser_research_complete",
                            "org": org_name,
                            "entries": len(browser_entries),
                        })

        phase["value"] = "finalizing"
        deduped_entries = [entry async for entry in deduplicate_stream(_iter_items(raw_entries))]
        deduped_entries_count = len(deduped_entries)

        ranked_entries = [
            ranked
            async for ranked in rank_entries_stream(_iter_items(deduped_entries), min_score=min_entry_score)
        ]

        for ranked in ranked_entries:
            await store.save_entry(
                run_id=run_id,
                name=ranked.entry.name,
                entry_type=str(ranked.entry.entry_type),
                description=ranked.entry.description,
                city=ranked.entry.city,
                state=ranked.entry.state,
                score=ranked.score,
                data=ranked.entry.model_dump(mode="json"),
            )

        gap_report = analyze_gaps(location, ranked_entries)

        # --- Contribute entries to Atlas API ---
        contribution_result = None
        if contribution_config and contribution_config.enabled:
            from atlas_scout.steps.contribute import contribute_entries

            phase["value"] = "contributing"
            emit("status", {"phase": "contributing", "entries": len(ranked_entries)})
            contribution_result = await contribute_entries(
                ranked_entries,
                atlas_url=contribution_config.atlas_url,
                api_key=contribution_config.api_key,
                min_score=contribution_config.min_score,
            )
            emit("status", {
                "phase": "contributed",
                "created": contribution_result.created,
                "failed": contribution_result.failed,
            })

        await store.complete_run(
            run_id,
            queries=queries_count,
            pages_fetched=stats["pages_fetched"],
            entries_found=len(raw_entries),
            entries_after_dedup=deduped_entries_count,
        )

        return PipelineResult(
            run_id=run_id,
            queries_generated=queries_count,
            pages_fetched=stats["pages_fetched"],
            entries_found=len(raw_entries),
            entries_after_dedup=deduped_entries_count,
            ranked_entries=ranked_entries,
            gap_report=gap_report,
            page_outcomes=list(page_outcomes_by_task.values()),
        )
    except asyncio.CancelledError as exc:
        await store.cancel_run(run_id, str(exc) or "cancelled")
        raise
    except Exception as exc:
        logger.error("Pipeline failed for run %s: %s", run_id, exc)
        await store.fail_run(run_id, str(exc))
        raise
    finally:
        phase["value"] = "stopping"
        status_stop.set()
        for worker in fetch_workers + extract_workers:
            if not worker.done():
                worker.cancel()
        if fetch_workers:
            await asyncio.gather(*fetch_workers, return_exceptions=True)
        if extract_workers:
            await asyncio.gather(*extract_workers, return_exceptions=True)
        if status_task is not None:
            if not status_task.done():
                status_task.cancel()
            await asyncio.gather(status_task, return_exceptions=True)
        if own_fetcher:
            close = getattr(fetcher, "close", None)
            if callable(close):
                await close()


_parse_location = parse_location


async def _fetch_outcome(
    fetcher: AsyncFetcher,
    item: _FrontierItem,
    store: ScoutStore,
) -> dict[str, Any]:
    """Call the most capable tracked-fetch method the fetcher exposes."""
    if hasattr(fetcher, "fetch_tracked_verbose"):
        outcome = await fetcher.fetch_tracked_verbose(item.url, item.task_id, store)
        if isinstance(outcome, dict):
            return outcome

    if hasattr(fetcher, "fetch_tracked"):
        page = await fetcher.fetch_tracked(item.url, item.task_id, store)
        return {
            "url": item.url,
            "task_id": item.task_id,
            "page": page,
            "status": "fetched" if page is not None else "filtered",
            "error": None if page is not None else "content_not_extractable",
            "discovered_links": page.discovered_links if page is not None else [],
        }

    page = await fetcher.fetch(item.url)
    if page is not None:
        page = page.model_copy(update={"task_id": item.task_id})
    return {
        "url": item.url,
        "task_id": item.task_id,
        "page": page,
        "status": "fetched" if page is not None else "filtered",
        "error": None if page is not None else "content_not_extractable",
        "discovered_links": page.discovered_links if page is not None else [],
    }


async def _produce_search_frontier(
    *,
    queries: list[str],
    search_api_key: str,
    enqueue: Callable[..., asyncio.Future | Any],
    max_concurrent: int,
    results_per_query: int = 5,
) -> None:
    """Search queries concurrently and enqueue unique result URLs as they arrive."""
    semaphore = asyncio.Semaphore(max(1, max_concurrent))

    async def _search_one(query: str) -> list[dict[str, str | None]]:
        async with semaphore:
            return await source_fetch._search_brave(
                [query], search_api_key, results_per_query=results_per_query
            )

    tasks = [asyncio.create_task(_search_one(query)) for query in queries]
    for task in asyncio.as_completed(tasks):
        results = await task
        for result in results:
            url = result.get("url")
            if isinstance(url, str) and url:
                normalized = normalize_url(url)
                if normalized:
                    maybe = enqueue(
                        normalized,
                        depth=0,
                        seed_url=normalized,
                        discovered_from=None,
                    )
                    if asyncio.iscoroutine(maybe):
                        await maybe


async def _iter_items(items: list[Any]):
    """Yield items from a plain list as an async iterator."""
    for item in items:
        yield item
