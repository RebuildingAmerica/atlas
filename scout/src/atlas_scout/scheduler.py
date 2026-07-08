"""Scheduled discovery runner.

Executes pipeline runs for configured targets on a cron-like interval,
enabling autonomous periodic discovery without human invocation.
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from atlas_scout.scheduler_support import (
    _close_scheduler_resources,
    _completed_tick_summary,
    _cron_to_interval,
    _open_scheduler_resources,
    _run_schedule_targets,
    _stop_requested,
    _wait_for_next_tick,
)

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig
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
        process_id: int | None = None,
        interval_seconds: int | None = None,
        interval_basis: str | None = None,
        started_at: datetime | None = None,
    ) -> None:
        """Persist the daemon started state."""
        await store.start_daemon(
            config_path=self.config_path,
            profile_name=self.profile_name,
            target_count=target_count,
            process_id=process_id,
            interval_seconds=interval_seconds,
            interval_basis=interval_basis,
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
    requested_interval_seconds = interval_seconds
    interval_basis = (
        f"fixed {requested_interval_seconds}s override"
        if requested_interval_seconds > 0
        else f"cron {config.schedule.cron}"
    )
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
                process_id=os.getpid(),
                interval_seconds=interval_seconds,
                interval_basis=interval_basis,
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


from atlas_scout.pipeline_support import error_reason as _error_reason  # noqa: E402
