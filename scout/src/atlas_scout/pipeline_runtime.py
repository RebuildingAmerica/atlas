"""Top-level Scout pipeline orchestration."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from atlas_scout.pipeline_articles import effective_target_count, process_article_backlog
from atlas_scout.pipeline_deepening import run_iterative_deepening
from atlas_scout.pipeline_fetch_support import produce_search_frontier
from atlas_scout.pipeline_finalize import finalize_pipeline
from atlas_scout.pipeline_state import PipelineResult, PipelineState
from atlas_scout.pipeline_status import status_reporter
from atlas_scout.pipeline_support import extract_worker_count, normalize_url, parse_location
from atlas_scout.pipeline_workers import enqueue_url, extract_worker, fetch_worker
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

__all__ = ["_STATUS_INTERVAL_SECONDS", "PipelineResult", "_parse_location", "run_pipeline"]


async def run_pipeline(
    *,
    location: str,
    issues: list[str],
    provider: LLMProvider,
    store: ScoutStore,
    search_api_key: str = "",
    search_depth: str = "standard",
    min_entry_score: float = 0.15,
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

    city, state_code = parse_location(location)
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

    state = PipelineState(
        run_id=run_id,
        location=location,
        issues=issues,
        provider=provider,
        store=store,
        city=city,
        state=state_code,
        search_api_key=search_api_key,
        search_depth=search_depth,
        min_entry_score=min_entry_score,
        reuse_cached_extractions=reuse_cached_extractions,
        fetcher=fetcher,
        direct_urls=direct_urls,
        on_progress=on_progress,
        extraction_directive=extraction_directive,
        search_concurrency=search_concurrency,
        follow_links=follow_links,
        max_link_depth=max_link_depth,
        max_pages_per_seed=max_pages_per_seed,
        iterative_deepening=iterative_deepening,
        contribution_config=contribution_config,
        remote_run_id=remote_run_id,
        structured_columns=structured_columns,
        target_count=target_count,
        own_fetcher=own_fetcher,
        started_at=started_at,
        frontier_queue=asyncio.Queue(),
        extract_queue=asyncio.PriorityQueue(),
        frontier_lock=asyncio.Lock(),
    )
    state.effective_target_count = effective_target_count(
        target_count=target_count,
        direct_mode=bool(direct_urls),
    )

    status_task: asyncio.Task[None] | None = None
    fetch_workers: list[asyncio.Task[None]] = []
    extract_workers: list[asyncio.Task[None]] = []

    try:
        status_task = asyncio.create_task(status_reporter(state))
        fetch_worker_count = max(1, int(getattr(fetcher, "max_concurrent", 8) or 8))
        fetch_workers = [
            asyncio.create_task(fetch_worker(state)) for _ in range(fetch_worker_count)
        ]
        extract_workers = [
            asyncio.create_task(extract_worker(state))
            for _ in range(extract_worker_count(provider, direct_mode=bool(direct_urls)))
        ]

        state.set_phase("building_frontier")
        if direct_urls:
            for url in direct_urls:
                normalized = normalize_url(url)
                if normalized:
                    await enqueue_url(
                        state,
                        normalized,
                        depth=0,
                        seed_url=normalized,
                        discovered_from=None,
                    )
        else:
            state.set_phase("article_backlog")
            article_pages_processed = await process_article_backlog(state)
            state.set_phase("building_frontier")
            if not state.target_reached():
                if not search_api_key:
                    if article_pages_processed == 0:
                        raise ValueError(
                            "Connect search or build a local article corpus before running by place and issue."
                        )
                else:
                    queries = generate_queries(city=city, state=state_code, issue_areas=issues)
                    state.queries_count = len(queries)
                    await produce_search_frontier(
                        queries=[query.query for query in queries],
                        search_api_key=search_api_key,
                        enqueue=lambda url, *, depth, seed_url, discovered_from: enqueue_url(
                            state,
                            url,
                            depth=depth,
                            seed_url=seed_url,
                            discovered_from=discovered_from,
                        ),
                        max_concurrent=search_concurrency or 8,
                        results_per_query=results_per_query_for_depth(search_depth),
                    )

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

        state.set_phase("draining_fetch")
        await state.frontier_queue.join()
        for _ in fetch_workers:
            await state.frontier_queue.put(None)
        await asyncio.gather(*fetch_workers)

        state.set_phase("draining_extract")
        await state.extract_queue.join()
        for idx, _worker in enumerate(extract_workers, start=1):
            await state.extract_queue.put((10**9, idx, None))
        await asyncio.gather(*extract_workers)

        await run_iterative_deepening(state)
        return await finalize_pipeline(state)
    except asyncio.CancelledError as exc:
        await store.cancel_run(run_id, str(exc) or "cancelled")
        raise
    except Exception as exc:
        logger.error("Pipeline failed for run %s: %s", run_id, exc)
        await store.fail_run(run_id, str(exc))
        raise
    finally:
        state.set_phase("stopping")
        state.status_stop.set()
        for worker in fetch_workers + extract_workers:
            if not worker.done():
                worker.cancel()
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


_parse_location = parse_location
