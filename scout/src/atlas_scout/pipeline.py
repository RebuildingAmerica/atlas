"""Concurrency-native Scout pipeline with tracked page tasks and progress events."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from atlas_shared import (
    DiscoveryRunArtifacts,
    DiscoveryRunStats,
    GapReport,
    PageContent,
    RankedEntry,
    RawEntry,
)

from atlas_scout.article_backlog import article_page_from_record
from atlas_scout.pipeline_artifacts import (
    build_run_artifacts,
    can_build_run_artifacts,
    save_ranked_entries,
)
from atlas_scout.pipeline_fetch_support import (
    fetch_outcome,
    iter_items,
    page_with_structured_columns,
    produce_search_frontier,
)
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
from atlas_scout.steps.discovery_engine_adapters import deduplicate_stream, rank_entries_stream
from atlas_scout.steps.entry_extract import (
    _build_system_prompt,
    _prompt_key,
    _provider_cache_key,
    extract_page_entries,
)
from atlas_scout.steps.gap_analysis import analyze_gaps
from atlas_scout.steps.query_gen import generate_queries
from atlas_scout.steps.source_fetch import results_per_query_for_depth

if TYPE_CHECKING:
    from collections.abc import Callable

    from atlas_scout.config import ContributionConfig
    from atlas_scout.providers.base import LLMProvider
    from atlas_scout.scraper.fetcher import AsyncFetcher
    from atlas_scout.store import ScoutStore


logger = logging.getLogger(__name__)

_STATUS_INTERVAL_SECONDS = 0.5
_DEFAULT_LOCATION_TARGET_COUNT = 250
_ARTICLE_BACKLOG_BATCH_LIMIT = 500
_ARTICLE_EXTRACTION_LEASE_SECONDS = 600

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
    artifacts: DiscoveryRunArtifacts | None = None


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
    remote_run_id: str | None = None,
    structured_columns: list[str] | None = None,
    target_count: int | None = None,
) -> PipelineResult:
    """Run Scout discovery for known URLs or a place and issue set."""
    from atlas_scout.scraper.fetcher import AsyncFetcher as DefaultFetcher

    city, state = parse_location(location)
    run_id = await store.create_run(location=location, issues=issues, search_depth=search_depth)
    await store.update_run_status(run_id, "running")
    started_at = datetime.now(UTC)

    own_fetcher = fetcher is None
    fetcher = fetcher or DefaultFetcher(store=store, run_id=run_id)
    bind_run = getattr(fetcher, "bind_run", None)
    if callable(bind_run):
        maybe = bind_run(run_id)
        if asyncio.iscoroutine(maybe):
            await maybe

    frontier_queue: asyncio.Queue[_FrontierItem | None] = asyncio.Queue()
    extract_queue: asyncio.PriorityQueue[tuple[int, int, PageContent | None]] = (
        asyncio.PriorityQueue()
    )
    frontier_lock = asyncio.Lock()

    queries_count = 0
    raw_entries: list[RawEntry] = []
    ranked_entries: list[RankedEntry] = []
    deduped_entries_count = 0
    fetched_pages_by_url: dict[str, PageContent] = {}
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
    effective_target_count = _effective_target_count(
        target_count=target_count,
        direct_mode=bool(direct_urls),
    )
    phase = {"value": "starting"}
    status_stop = asyncio.Event()

    def target_reached() -> bool:
        return effective_target_count is not None and len(raw_entries) >= effective_target_count

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
        # Callers (direct_urls loop, search frontier producer, fetch worker) all
        # pre-normalize and pre-domain-check before reaching here. The asserts make
        # those invariants visible so the function can't be silently misused.
        normalized = normalize_url(url)
        assert normalized, "enqueue_url callers must pre-normalize URLs"

        current_domain = discovered_from or seed_url
        assert not (discovered_from and not same_domain(current_domain, normalized)), (
            "enqueue_url callers must pre-check domain for discovered_from links"
        )

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
        # decide_extraction_admission always returns a non-None priority today.
        # Keep the invariant explicit so pipeline orchestration never silently
        # tries to admit a filtered page.
        assert admission.should_extract, (
            "extract admission must yield a priority for every fetched page"
        )

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
        # Asserted above: admission.priority is not None whenever we reach here.
        assert admission.priority is not None
        await extract_queue.put((admission.priority, extract_order, page))
        return True

    def remember_page(page: PageContent) -> None:
        """Record fetched page metadata for later Atlas contribution."""
        fetched_pages_by_url[page.url] = page

    async def fetch_worker() -> None:
        while True:
            item = await frontier_queue.get()
            if item is None:
                frontier_queue.task_done()
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

                outcome = await fetch_outcome(
                    fetcher, url=item.url, task_id=item.task_id, store=store
                )
                discovered_links = merge_discovered_links(
                    outcome.get("discovered_links"),
                    outcome.get("page"),
                )
                page = outcome.get("page")
                error = outcome.get("error")
                fetch_status = str(outcome.get("status") or ("fetched" if page else "filtered"))

                if isinstance(page, PageContent):
                    remember_page(page)
                    page = page.model_copy(
                        update={
                            "task_id": item.task_id,
                            "discovered_links": discovered_links,
                        }
                    )
                    stats["pages_fetched"] += 1
                    await enqueue_extract_candidate(
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

                    page_outcomes_by_task[item.task_id].update(
                        status="fetched",
                        error=None,
                        discovered_links=discovered_links,
                    )
                    await store.update_page_task(item.task_id, "fetched")
                    # enqueue_extract_candidate above marked this task user-visible,
                    # so the page_fetched event is always emitted on the success path.
                    assert item.task_id in visible_page_tasks
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
                                if queued:  # pragma: no branch
                                    queued_links += 1
                    skip_status = (
                        "filtered" if fetch_status in {"filtered", "skipped"} else fetch_status
                    )
                    page_outcomes_by_task[item.task_id].update(
                        status=skip_status,
                        error=error,
                        discovered_links=discovered_links,
                    )
                    await store.update_page_task(
                        item.task_id, skip_status, error=str(error) if error else None
                    )
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
                extract_queue.task_done()
                return

            # The fetch_worker always stamps task_id onto every page it places on
            # the extract queue; empty task_id would mean a programmer error rather
            # than a runtime condition.
            assert page.task_id, "extract_worker requires a task_id on every queued page"
            task_id = page.task_id
            stats["extract_active"] += 1
            try:
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

                def emit_extract_retry(
                    payload: dict[str, object],
                    current_task_id: str = task_id,
                ) -> None:
                    emit(
                        "extract_retry",
                        {
                            **payload,
                            "task_id": current_task_id,
                        },
                    )

                entries = await extract_page_entries(
                    page_with_structured_columns(page, structured_columns),
                    provider,
                    city,
                    state,
                    store=store,
                    run_id=run_id,
                    reuse_cached_extractions=reuse_cached_extractions,
                    extraction_directive=extraction_directive,
                    on_retry=emit_extract_retry,
                )

                if entries:
                    raw_entries.extend(entries)
                    await store.update_page_task(
                        task_id, "extracted", entries_extracted=len(entries)
                    )
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
                    await store.update_page_task(task_id, "extract_empty", entries_extracted=0)
                    page_outcomes_by_task[task_id].update(status="extract_empty", entries=0)
                    emit(
                        "extract_empty",
                        {
                            "url": page.url,
                            "task_id": task_id,
                        },
                    )
                    # The fetch_worker promotes every extracted page to user-visible
                    # via enqueue_extract_candidate, so the page_skipped event always fires.
                    assert task_id in visible_page_tasks
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
                # See the assert above: extracted pages are always user-visible by
                # the time extract_worker runs.
                assert task_id in visible_page_tasks
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

    async def process_article_backlog() -> int:
        if direct_urls:
            return 0

        provider_key, prompt_key = _extraction_identity(
            provider,
            city=city,
            state=state,
            extraction_directive=extraction_directive,
        )
        processed = 0
        while not target_reached():
            claim_limit = _article_backlog_claim_limit(
                target_count=effective_target_count,
                current_entries=len(raw_entries),
            )
            article_rows = await store.claim_article_extraction_batch(
                owner_run_id=run_id,
                provider_key=provider_key,
                prompt_key=prompt_key,
                limit=claim_limit,
                lease_seconds=_ARTICLE_EXTRACTION_LEASE_SECONDS,
                retry_failed=not reuse_cached_extractions,
            )
            if not article_rows:
                return processed

            for article in article_rows:
                if target_reached():
                    return processed
                article_url = str(article.get("url") or "")
                if not article_url:
                    continue
                task_id = await store.create_page_task(run_id, article_url)
                page_outcomes_by_task[task_id] = {
                    "task_id": task_id,
                    "url": article_url,
                    "depth": 0,
                    "status": "queued",
                    "error": None,
                    "entries": 0,
                    "user_visible": True,
                }
                visible_page_tasks.add(task_id)
                emit(
                    "page_found",
                    {
                        "url": article_url,
                        "depth": 0,
                        "task_id": task_id,
                    },
                )

                page = article_page_from_record(article)
                if page is None:
                    page = await _refetch_article_page(fetcher, article_url)
                if page is None:
                    reason = "article_text_unavailable"
                    await store.update_page_task(task_id, "fetch_failed", error=reason)
                    page_outcomes_by_task[task_id].update(status="fetch_failed", error=reason)
                    await store.fail_article_extraction(
                        article_url=article_url,
                        provider_key=provider_key,
                        prompt_key=prompt_key,
                        error=reason,
                    )
                    continue

                page = page.model_copy(update={"task_id": task_id})
                remember_page(page)
                stats["pages_fetched"] += 1
                processed += 1
                await store.update_page_task(task_id, "extracting")
                page_outcomes_by_task[task_id]["status"] = "extracting"
                try:
                    entries = await extract_page_entries(
                        page_with_structured_columns(page, structured_columns),
                        provider,
                        city,
                        state,
                        store=store,
                        run_id=run_id,
                        reuse_cached_extractions=reuse_cached_extractions,
                        extraction_directive=extraction_directive,
                    )
                except Exception as exc:
                    reason = error_reason(exc)
                    await store.update_page_task(task_id, "extract_failed", error=reason)
                    page_outcomes_by_task[task_id].update(status="extract_failed", error=reason)
                    await store.fail_article_extraction(
                        article_url=article_url,
                        provider_key=provider_key,
                        prompt_key=prompt_key,
                        error=reason,
                    )
                    emit(
                        "extract_failed",
                        {
                            "url": article_url,
                            "task_id": task_id,
                            "reason": reason,
                        },
                    )
                    continue

                raw_entries.extend(entries)
                status = "extracted" if entries else "extract_empty"
                await store.update_page_task(task_id, status, entries_extracted=len(entries))
                page_outcomes_by_task[task_id].update(status=status, entries=len(entries))
                await store.complete_article_extraction(
                    article_url=article_url,
                    provider_key=provider_key,
                    prompt_key=prompt_key,
                    entries_extracted=len(entries),
                )
                emit(
                    "extract_completed" if entries else "extract_empty",
                    {
                        "url": article_url,
                        "task_id": task_id,
                        "entries": len(entries),
                    },
                )
                for entry in entries:
                    emit(
                        "entity_found",
                        {
                            "url": article_url,
                            "task_id": task_id,
                            "name": entry.name,
                            "entry_type": str(entry.entry_type),
                        },
                    )

        return processed

    status_task: asyncio.Task[None] | None = None
    fetch_workers: list[asyncio.Task[None]] = []
    extract_workers: list[asyncio.Task[None]] = []

    try:
        status_task = asyncio.create_task(status_reporter())
        fetch_worker_count = max(
            1,
            int(getattr(fetcher, "max_concurrent", 8) or 8),
        )
        fetch_workers = [asyncio.create_task(fetch_worker()) for _ in range(fetch_worker_count)]
        extract_workers = [
            asyncio.create_task(extract_worker())
            for _ in range(extract_worker_count(provider, direct_mode=bool(direct_urls)))
        ]

        phase["value"] = "building_frontier"
        if direct_urls:
            for url in direct_urls:
                normalized = normalize_url(url)
                if normalized:
                    await enqueue_url(
                        normalized, depth=0, seed_url=normalized, discovered_from=None
                    )
        else:
            phase["value"] = "article_backlog"
            article_pages_processed = await process_article_backlog()
            phase["value"] = "building_frontier"
            if not target_reached():
                if not search_api_key:
                    if article_pages_processed == 0:
                        raise ValueError(
                            "Connect search or build a local article corpus before running by place and issue."
                        )
                else:
                    queries = generate_queries(city=city, state=state, issue_areas=issues)
                    queries_count = len(queries)
                    await produce_search_frontier(
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
            from atlas_scout.steps.browser_research import research_org_website
            from atlas_scout.steps.entity_chase import (
                generate_followup_queries,
                select_entities_to_chase,
            )

            phase["value"] = "deepening"

            async def claim_new_url(candidate: str) -> str | None:
                """Normalize a candidate URL and claim it if not already seen."""
                normalized = normalize_url(candidate)
                if not normalized or normalized in seen_urls:
                    return None
                seen_urls.add(normalized)
                return normalized

            async def fetch_and_extract(url: str) -> None:
                """Fetch one URL directly and extend raw_entries with any entries found."""
                page = await fetcher.fetch(url)
                if page is None:
                    return
                remember_page(page)
                stats["pages_fetched"] += 1
                entries = await extract_page_entries(
                    page,
                    provider,
                    city,
                    state,
                    store=store,
                    run_id=run_id,
                    reuse_cached_extractions=reuse_cached_extractions,
                    extraction_directive=extraction_directive,
                )
                if entries:
                    raw_entries.extend(entries)

            preliminary_deduped = [
                entry async for entry in deduplicate_stream(iter_items(raw_entries))
            ]
            preliminary_ranked = [
                r
                async for r in rank_entries_stream(
                    iter_items(preliminary_deduped), min_score=min_entry_score
                )
            ]
            preliminary_gaps = analyze_gaps(location, preliminary_ranked)

            # --- 1. Follow discovery leads from extraction ---
            all_leads: list[str] = []
            for entry in raw_entries:
                for lead in getattr(entry, "discovery_leads", []):
                    claimed = await claim_new_url(lead)
                    if claimed:
                        all_leads.append(claimed)

            if all_leads:
                emit("status", {"phase": "following_leads", "lead_count": len(all_leads)})
                for url in all_leads[:50]:  # cap at 50 leads
                    await fetch_and_extract(url)

            # --- 2. LLM-driven follow-up queries ---
            # Iterative deepening needs connected search because it follows new
            # source leads after the initial frontier has drained.
            assert search_api_key, "iterative deepening requires a non-empty search key"
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
                emit(
                    "status",
                    {
                        "phase": "deepening_search",
                        "followup_queries": len(followup_queries),
                    },
                )
                deeper_rpq = results_per_query_for_depth("deep")
                deeper_results = await source_fetch._search_brave(
                    [q.query for q in followup_queries],
                    search_api_key,
                    results_per_query=deeper_rpq,
                )
                for result in deeper_results:
                    result_url = result.get("url")
                    if isinstance(result_url, str) and result_url:
                        claimed = await claim_new_url(result_url)
                        if claimed:
                            await fetch_and_extract(claimed)

            # --- 3. Entity chasing: fetch org websites for staff/board/partners ---
            emit("status", {"phase": "entity_chasing"})
            # Re-rank with new entries before chasing
            chase_deduped = [entry async for entry in deduplicate_stream(iter_items(raw_entries))]
            chase_ranked = [
                r
                async for r in rank_entries_stream(
                    iter_items(chase_deduped), min_score=min_entry_score
                )
            ]
            chase_targets = await select_entities_to_chase(
                provider,
                entries=chase_ranked,
            )
            for target in chase_targets:
                target_url = target.get("website", "")
                if target_url:
                    claimed = await claim_new_url(target_url)
                    if claimed:
                        await fetch_and_extract(claimed)

                # Also search for the entity if we have a query
                search_query = target.get("search_query", "")
                if search_query and search_api_key:
                    chase_results = await source_fetch._search_brave(
                        [search_query],
                        search_api_key,
                        results_per_query=5,
                    )
                    for result in chase_results:
                        result_url = result.get("url")
                        if isinstance(result_url, str) and result_url:
                            claimed = await claim_new_url(result_url)
                            if claimed:
                                await fetch_and_extract(claimed)

            # --- 4. Browser research: deep-dive into top org websites ---
            browser_targets = [
                t for t in chase_targets if t.get("website") and normalize_url(t["website"])
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
                        emit(
                            "status",
                            {
                                "phase": "browser_research_complete",
                                "org": org_name,
                                "entries": len(browser_entries),
                            },
                        )

        phase["value"] = "finalizing"
        deduped_entries = [entry async for entry in deduplicate_stream(iter_items(raw_entries))]
        deduped_entries_count = len(deduped_entries)

        ranked_entries = [
            ranked
            async for ranked in rank_entries_stream(
                iter_items(deduped_entries), min_score=min_entry_score
            )
        ]

        await save_ranked_entries(store=store, run_id=run_id, ranked_entries=ranked_entries)

        gap_report = analyze_gaps(location, ranked_entries)
        run_stats = DiscoveryRunStats(
            queries_generated=queries_count,
            sources_fetched=stats["pages_fetched"],
            sources_processed=stats["pages_fetched"],
            entries_extracted=len(raw_entries),
            entries_after_dedup=deduped_entries_count,
            entries_confirmed=len(ranked_entries),
        )
        artifacts: DiscoveryRunArtifacts | None = None
        if can_build_run_artifacts(location=location, state=state, issues=issues):
            artifacts = build_run_artifacts(
                run_id=run_id,
                location=location,
                state=state,
                issues=issues,
                search_depth=search_depth,
                started_at=started_at,
                completed_at=datetime.now(UTC),
                stats=run_stats,
                page_outcomes=page_outcomes_by_task,
                sources=list(fetched_pages_by_url.values()),
                raw_entries=raw_entries,
                ranked_entries=ranked_entries,
                gap_report=gap_report,
                remote_run_id=remote_run_id,
            )
            await store.save_run_artifacts(run_id, artifacts)
        else:
            logger.info(
                "Skipping artifact persistence for run %s because known-URL runs lack canonical run metadata",
                run_id,
            )

        # --- Contribute entries to Atlas API ---
        contribution_result = None
        if contribution_config and contribution_config.enabled and artifacts is not None:
            from atlas_scout.steps.contribute import sync_run_artifacts

            phase["value"] = "contributing"
            emit("status", {"phase": "contributing", "entries": len(ranked_entries)})
            await store.update_run_sync(run_id, sync_status="syncing")
            contribution_result = await sync_run_artifacts(
                artifacts,
                atlas_url=contribution_config.atlas_url,
                api_key=contribution_config.api_key,
            )
            if contribution_result.errors:
                artifacts = await store.update_run_sync(
                    run_id,
                    sync_status="failed",
                    last_error="; ".join(contribution_result.errors),
                )
            else:
                artifacts = await store.update_run_sync(
                    run_id,
                    sync_status=contribution_result.sync_status or "synced",
                    remote_run_id=contribution_result.run_id,
                    synced_at=datetime.now(UTC),
                )
            emit(
                "status",
                {
                    "phase": "contributed",
                    "created": contribution_result.created,
                    "failed": contribution_result.failed,
                },
            )
        elif contribution_config and contribution_config.enabled:
            logger.warning(
                "Skipping Atlas sync for run %s because canonical run metadata was not provided",
                run_id,
            )

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
            artifacts=artifacts,
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
        # Workers and the status task are always scheduled together at the top of
        # the try block; if `try` runs at all they are populated.
        assert fetch_workers, "fetch_workers must be populated before finally runs"
        assert extract_workers, "extract_workers must be populated before finally runs"
        assert status_task is not None, "status_task must be populated before finally runs"
        await asyncio.gather(*fetch_workers, return_exceptions=True)
        await asyncio.gather(*extract_workers, return_exceptions=True)
        if not status_task.done():
            status_task.cancel()
        await asyncio.gather(status_task, return_exceptions=True)
        if own_fetcher:
            close = getattr(fetcher, "close", None)
            if callable(close):
                await close()


def _extraction_identity(
    provider: LLMProvider,
    *,
    city: str,
    state: str,
    extraction_directive: str | None = None,
) -> tuple[str, str]:
    """Return the provider/prompt identity used by extraction caching."""
    system_prompt = _build_system_prompt(city, state, extraction_directive=extraction_directive)
    return _provider_cache_key(provider), _prompt_key(system_prompt)


def _effective_target_count(*, target_count: int | None, direct_mode: bool) -> int | None:
    """Return the entry target for this run, if one should bound discovery."""
    if target_count is not None and target_count > 0:
        return target_count
    if direct_mode:
        return None
    return _DEFAULT_LOCATION_TARGET_COUNT


def _article_backlog_claim_limit(*, target_count: int | None, current_entries: int) -> int:
    """Return how many article rows to claim for the next recovery batch."""
    if target_count is None:
        return _ARTICLE_BACKLOG_BATCH_LIMIT
    remaining = max(target_count - current_entries, 0)
    if remaining <= 0:
        return 0
    return min(_ARTICLE_BACKLOG_BATCH_LIMIT, remaining)


async def _refetch_article_page(fetcher: AsyncFetcher, article_url: str) -> PageContent | None:
    """Fetch an article page when the stored article row lacks usable text."""
    fetch = getattr(fetcher, "fetch", None)
    if not callable(fetch):
        return None
    page = await fetch(article_url)
    return page if isinstance(page, PageContent) else None


_parse_location = parse_location
