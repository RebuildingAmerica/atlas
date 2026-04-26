"""Scheduled discovery runner.

Executes pipeline runs for configured targets on a cron-like interval,
enabling autonomous periodic discovery without human invocation.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig
    from atlas_scout.providers.base import LLMProvider
    from atlas_scout.runtime import RuntimeProfile
    from atlas_scout.store import ScoutStore

logger = logging.getLogger(__name__)

__all__ = ["SchedulerDaemonLifecycle", "run_schedule_loop", "run_schedule_once"]


@dataclass(frozen=True, slots=True)
class SchedulerDaemonLifecycle:
    """Lifecycle helper for persisting scheduler daemon state."""

    config_path: str
    profile_name: str | None = None

    async def mark_started(
        self,
        store: ScoutStore,
        *,
        target_count: int,
        started_at: datetime | None = None,
    ) -> None:
        """Persist the daemon started state."""
        await store.start_daemon(
            config_path=self.config_path,
            profile_name=self.profile_name,
            target_count=target_count,
            started_at=started_at,
        )

    async def record_heartbeat(
        self,
        store: ScoutStore,
        *,
        heartbeat_at: datetime | None = None,
    ) -> None:
        """Persist a scheduler heartbeat for the running daemon."""
        await store.record_daemon_heartbeat(heartbeat_at=heartbeat_at)

    async def record_tick_complete(
        self,
        store: ScoutStore,
        *,
        run_ids: list[str],
        started_at: datetime,
        completed_at: datetime,
    ) -> None:
        """Persist a successful scheduler tick result."""
        await self.record_heartbeat(store, heartbeat_at=completed_at)
        await store.record_daemon_tick_result(
            status="completed",
            run_count=len(run_ids),
            summary=_completed_tick_summary(len(run_ids)),
            started_at=started_at,
            completed_at=completed_at,
            error=None,
        )

    async def record_tick_failure(
        self,
        store: ScoutStore,
        *,
        started_at: datetime,
        completed_at: datetime,
        exc: Exception,
    ) -> None:
        """Persist a failed scheduler tick result."""
        reason = _error_reason(exc)
        await self.record_heartbeat(store, heartbeat_at=completed_at)
        await store.record_daemon_tick_result(
            status="failed",
            run_count=0,
            summary=f"Scheduler tick failed: {reason}",
            started_at=started_at,
            completed_at=completed_at,
            error=reason,
        )

    async def mark_stopped(
        self,
        store: ScoutStore,
        *,
        stopped_at: datetime | None = None,
    ) -> None:
        """Persist the daemon stopped state."""
        await store.stop_daemon(stopped_at=stopped_at)


@dataclass(slots=True)
class _SchedulerResources:
    """Shared scheduler dependencies for one foreground or loop session."""

    config: ScoutConfig
    search_api_key: str
    profile: RuntimeProfile
    provider: LLMProvider
    store: ScoutStore


async def run_schedule_once(config: ScoutConfig, search_api_key: str) -> list[str]:
    """
    Run the pipeline once for every configured schedule target.

    Returns a list of run IDs for completed runs.
    """
    if not config.schedule.targets:
        logger.info("No schedule targets configured - nothing to run")
        return []

    resources = await _open_scheduler_resources(config, search_api_key)
    try:
        return await _run_schedule_targets(resources)
    finally:
        await _close_scheduler_resources(resources)


async def run_schedule_loop(
    config: ScoutConfig,
    search_api_key: str,
    interval_seconds: int = 0,
    *,
    lifecycle: SchedulerDaemonLifecycle | None = None,
    stop_event: asyncio.Event | None = None,
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

    resources = await _open_scheduler_resources(config, search_api_key)

    try:
        if lifecycle is not None:
            await lifecycle.mark_started(
                resources.store,
                target_count=len(config.schedule.targets),
                started_at=datetime.now(UTC),
            )

        while not _stop_requested(stop_event):
            started = datetime.now(UTC)
            if lifecycle is not None:
                await lifecycle.record_heartbeat(resources.store, heartbeat_at=started)

            try:
                run_ids = await _run_schedule_targets(resources)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                completed = datetime.now(UTC)
                logger.exception("Scheduler tick failed at %s", started.isoformat())
                if lifecycle is not None:
                    await lifecycle.record_tick_failure(
                        resources.store,
                        started_at=started,
                        completed_at=completed,
                        exc=exc,
                    )
            else:
                completed = datetime.now(UTC)
                logger.info(
                    "Scheduler tick complete at %s - %d runs",
                    started.isoformat(),
                    len(run_ids),
                )
                if lifecycle is not None:
                    await lifecycle.record_tick_complete(
                        resources.store,
                        run_ids=run_ids,
                        started_at=started,
                        completed_at=completed,
                    )

            if _stop_requested(stop_event):
                break

            if await _wait_for_next_tick(interval_seconds, stop_event):
                break
    finally:
        stop_error: Exception | None = None
        if lifecycle is not None:
            try:
                await lifecycle.mark_stopped(resources.store, stopped_at=datetime.now(UTC))
            except Exception as exc:
                stop_error = exc

        try:
            await _close_scheduler_resources(resources)
        except Exception:
            if stop_error is None:
                raise
            logger.exception("Scheduler resource cleanup failed after stop error")

        if stop_error is not None:
            raise stop_error


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
        asyncio.create_task(
            _run_target(target.location, target.issues, target.search_depth)
        )
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


from atlas_scout.pipeline_support import close_if_supported as _close_if_supported  # noqa: E402
from atlas_scout.pipeline_support import error_reason as _error_reason  # noqa: E402


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
