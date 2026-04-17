"""Scheduled discovery runner.

Executes pipeline runs for configured targets on a cron-like interval,
enabling autonomous periodic discovery without human invocation.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig

logger = logging.getLogger(__name__)

__all__ = ["run_schedule_loop", "run_schedule_once"]


async def run_schedule_once(config: ScoutConfig, search_api_key: str) -> list[str]:
    """
    Run the pipeline once for every configured schedule target.

    Returns a list of run IDs for completed runs.
    """
    from atlas_scout.pipeline import run_pipeline
    from atlas_scout.providers import create_provider
    from atlas_scout.runtime import build_runtime_profile
    from atlas_scout.scraper.fetcher import AsyncFetcher
    from atlas_scout.store import ScoutStore

    if not config.schedule.targets:
        logger.info("No schedule targets configured - nothing to run")
        return []

    profile = build_runtime_profile(config)
    provider = create_provider(config.llm, max_concurrent=profile.extract_concurrency)
    db_path = Path(config.store.path).expanduser()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    store = ScoutStore(str(db_path))
    await store.initialize()

    semaphore = asyncio.Semaphore(config.schedule.max_concurrent_runs)
    run_ids: list[str] = []

    async def _run_target(target_location: str, target_issues: list[str], depth: str) -> str | None:
        async with semaphore:
            fetcher = AsyncFetcher(
                store=store,
                max_concurrent=profile.fetch_concurrency,
                request_delay_ms=config.scraper.request_delay_ms,
                page_cache_ttl_days=config.scraper.page_cache_ttl_days,
                revisit_cached_urls=config.scraper.revisit_cached_urls,
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
                    provider=provider,
                    store=store,
                    search_api_key=search_api_key,
                    search_depth=depth,
                    min_entry_score=config.pipeline.min_entry_score,
                    reuse_cached_extractions=config.pipeline.reuse_cached_extractions,
                    fetcher=fetcher,
                    search_concurrency=profile.search_concurrency,
                    follow_links=config.scraper.follow_links,
                    max_link_depth=config.scraper.max_link_depth,
                    max_pages_per_seed=config.scraper.max_pages_per_seed,
                    iterative_deepening=config.pipeline.iterative_deepening,
                    contribution_config=config.contribution,
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
        asyncio.create_task(
            _run_target(target.location, target.issues, target.search_depth)
        )
        for target in config.schedule.targets
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    for r in results:
        if isinstance(r, str):
            run_ids.append(r)
        elif isinstance(r, Exception):
            logger.error("Scheduled target raised: %s", r)

    await _close_if_supported(provider)
    await store.close()

    return run_ids


async def run_schedule_loop(
    config: ScoutConfig,
    search_api_key: str,
    interval_seconds: int = 0,
) -> None:
    """
    Run scheduled discovery in a loop.

    If ``interval_seconds`` is 0, parses the cron expression from config
    and sleeps until the next matching time. Otherwise, uses a fixed interval.
    """
    if interval_seconds <= 0:
        interval_seconds = _cron_to_interval(config.schedule.cron)

    logger.info(
        "Scheduler started - %d targets, interval %ds",
        len(config.schedule.targets),
        interval_seconds,
    )

    while True:
        started = datetime.now(UTC)
        try:
            run_ids = await run_schedule_once(config, search_api_key)
            logger.info(
                "Scheduler tick complete at %s - %d runs",
                started.isoformat(),
                len(run_ids),
            )
        except Exception:
            logger.exception("Scheduler tick failed at %s", started.isoformat())
        await asyncio.sleep(interval_seconds)


from atlas_scout.pipeline_support import close_if_supported as _close_if_supported  # noqa: E402


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
