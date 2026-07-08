"""Internal helpers for the scheduled discovery runner."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from atlas_scout.pipeline_support import close_if_supported as _close_if_supported

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig
    from atlas_scout.providers.base import LLMProvider
    from atlas_scout.runtime import RuntimeProfile
    from atlas_scout.store import ScoutStore

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class _SchedulerResources:
    """Shared scheduler dependencies for one foreground or loop session."""

    config: ScoutConfig
    search_api_key: str
    profile: RuntimeProfile
    provider: LLMProvider
    store: ScoutStore


async def _open_scheduler_resources(
    config: ScoutConfig,
    search_api_key: str,
) -> _SchedulerResources:
    """Create the shared scheduler dependencies for one execution session."""
    from atlas_scout.providers import create_provider
    from atlas_scout.runtime import build_runtime_profile
    from atlas_scout.store import ScoutStore

    profile = build_runtime_profile(config)
    provider = create_provider(config.llm, max_concurrent=profile.extract_concurrency)
    db_path = Path(config.store.path).expanduser()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    store = ScoutStore(str(db_path))
    try:
        await store.initialize()
    except BaseException:
        await _close_if_supported(provider)
        raise

    return _SchedulerResources(
        config=config,
        search_api_key=search_api_key,
        profile=profile,
        provider=provider,
        store=store,
    )


async def _close_scheduler_resources(resources: _SchedulerResources) -> None:
    """Close shared scheduler dependencies in reverse setup order."""
    close_error: Exception | None = None

    try:
        await _close_if_supported(resources.provider)
    except Exception as exc:  # pragma: no cover - exercised via tests around caller behavior
        close_error = exc

    try:
        await resources.store.close()
    except Exception:
        if close_error is None:
            raise
        logger.exception("Store close failed after provider close error")

    if close_error is not None:
        raise close_error


async def _run_schedule_targets(resources: _SchedulerResources) -> list[str]:
    """Run the configured schedule targets using shared scheduler resources."""
    from atlas_scout.pipeline import run_pipeline
    from atlas_scout.scraper.fetcher import AsyncFetcher

    semaphore = asyncio.Semaphore(resources.config.schedule.max_concurrent_runs)
    run_ids: list[str] = []

    async def _run_target(target_location: str, target_issues: list[str], depth: str) -> str | None:
        async with semaphore:
            fetcher = AsyncFetcher(
                store=resources.store,
                max_concurrent=resources.profile.fetch_concurrency,
                request_delay_ms=resources.config.scraper.request_delay_ms,
                page_cache_ttl_days=resources.config.scraper.page_cache_ttl_days,
                revisit_cached_urls=resources.config.scraper.revisit_cached_urls,
                browser_fallback_enabled=resources.config.scraper.browser_fallback_enabled,
                browser_render_timeout_ms=resources.config.scraper.browser_render_timeout_ms,
                max_browser_renders_per_run=resources.config.scraper.max_browser_renders_per_run,
                max_browser_concurrent=resources.config.scraper.max_browser_concurrent,
            )
            try:
                logger.info(
                    "Scheduled run: %s [%s] depth=%s",
                    target_location,
                    ", ".join(target_issues),
                    depth,
                )
                result = await run_pipeline(
                    location=target_location,
                    issues=target_issues,
                    provider=resources.provider,
                    store=resources.store,
                    search_api_key=resources.search_api_key,
                    search_depth=depth,
                    min_entry_score=resources.config.pipeline.min_entry_score,
                    reuse_cached_extractions=resources.config.pipeline.reuse_cached_extractions,
                    fetcher=fetcher,
                    search_concurrency=resources.profile.search_concurrency,
                    follow_links=resources.config.scraper.follow_links,
                    max_link_depth=resources.config.scraper.max_link_depth,
                    max_pages_per_seed=resources.config.scraper.max_pages_per_seed,
                    iterative_deepening=resources.config.pipeline.iterative_deepening,
                    contribution_config=resources.config.contribution,
                )
                logger.info(
                    "Scheduled run complete: %s — %d entries (%d after dedup)",
                    target_location,
                    result.entries_found,
                    result.entries_after_dedup,
                )
                return result.run_id
            except Exception:
                logger.exception("Scheduled run failed for %s", target_location)
                return None
            finally:
                await _close_if_supported(fetcher)

    tasks = [
        asyncio.create_task(_run_target(target.location, target.issues, target.search_depth))
        for target in resources.config.schedule.targets
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    for result in results:
        if isinstance(result, str):
            run_ids.append(result)
        elif isinstance(result, Exception):
            logger.error("Scheduled target raised: %s", result)

    return run_ids


def _stop_requested(stop_event: asyncio.Event | None) -> bool:
    """Return True when an external stop has been requested."""
    return stop_event is not None and stop_event.is_set()


async def _wait_for_next_tick(
    interval_seconds: int,
    stop_event: asyncio.Event | None,
) -> bool:
    """Wait for the next scheduler tick or an external stop request."""
    if stop_event is None:
        await asyncio.sleep(interval_seconds)
        return False

    try:
        await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
    except TimeoutError:
        return False
    return True


def _completed_tick_summary(run_count: int) -> str:
    """Return a human-readable summary for a successful scheduler tick."""
    noun = "run" if run_count == 1 else "runs"
    return f"{run_count} scheduled {noun} completed"


def _cron_to_interval(cron_expr: str) -> int:
    """Convert a simple cron expression to a rough interval in seconds.

    This is a best-effort heuristic, not a full cron parser. For production
    scheduling, a proper cron library should be used.
    """
    parts = cron_expr.strip().split()
    if len(parts) < 5:
        return 86400  # daily fallback

    minute, hour = parts[0], parts[1]

    # "0 2 * * *" → daily at 2am → 86400s
    # "0 */6 * * *" → every 6 hours → 21600s
    # "*/30 * * * *" → every 30 min → 1800s
    if minute.startswith("*/"):
        try:
            return int(minute[2:]) * 60
        except ValueError:
            pass
    if hour.startswith("*/"):
        try:
            return int(hour[2:]) * 3600
        except ValueError:
            pass

    return 86400  # default to daily
