"""Firehose observation delivery worker."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING

from atlas.models import get_db_connection
from atlas.platform.database import db

from .model_deliveries import FirehoseObservationDeliveryCRUD
from .signal_materializer import create_signals_for_observation

if TYPE_CHECKING:
    import aiosqlite

logger = logging.getLogger(__name__)

MAX_RETRY_DELAY_SECONDS: int = 3600
BASE_RETRY_DELAY_SECONDS: int = 60

_worker_task: asyncio.Task[None] | None = None


@dataclass(slots=True)
class FirehoseDeliveryProcessingResult:
    """Summary of one Firehose delivery worker pass."""

    processed: int
    delivered: int
    failed: int


def _retry_delay_seconds(attempts: int) -> int:
    """Return bounded exponential retry delay for a delivery attempt."""
    delay: int = BASE_RETRY_DELAY_SECONDS * (2 ** max(attempts - 1, 0))
    return min(delay, MAX_RETRY_DELAY_SECONDS)


async def process_due_observation_deliveries(
    conn: aiosqlite.Connection,
    *,
    worker_id: str,
    now: str,
    lease_seconds: int,
    limit: int,
) -> FirehoseDeliveryProcessingResult:
    """Claim and process due Firehose observation deliveries."""
    deliveries = await FirehoseObservationDeliveryCRUD.claim_due(
        conn,
        worker_id=worker_id,
        now=now,
        lease_seconds=lease_seconds,
        limit=limit,
    )
    delivered = 0
    failed = 0
    for delivery in deliveries:
        try:
            await create_signals_for_observation(conn, observation_id=delivery.observation_id)
        except Exception as exc:  # pragma: no cover - exact exception is producer-specific
            await FirehoseObservationDeliveryCRUD.mark_failed(
                conn,
                delivery_id=delivery.id,
                failed_at=now,
                last_error=str(exc),
                retry_delay_seconds=_retry_delay_seconds(delivery.attempts),
            )
            failed += 1
            continue

        await FirehoseObservationDeliveryCRUD.mark_delivered(
            conn,
            delivery_id=delivery.id,
            delivered_at=now,
        )
        delivered += 1

    return FirehoseDeliveryProcessingResult(
        processed=len(deliveries),
        delivered=delivered,
        failed=failed,
    )


async def start_delivery_worker(
    database_url: str,
    *,
    database_backend: str | None = None,
    poll_seconds: float = 10,
    lease_seconds: int = 60,
    batch_size: int = 25,
) -> None:
    """Start the background Firehose observation delivery worker."""
    global _worker_task  # noqa: PLW0603
    if _worker_task is not None and not _worker_task.done():
        logger.warning("Firehose delivery worker already running")
        return

    _worker_task = asyncio.create_task(
        _worker_loop(
            database_url,
            database_backend=database_backend,
            poll_seconds=poll_seconds,
            lease_seconds=lease_seconds,
            batch_size=batch_size,
        ),
        name="firehose-delivery-worker",
    )
    logger.info("Firehose delivery worker started")


async def stop_delivery_worker() -> None:
    """Stop the background Firehose observation delivery worker."""
    global _worker_task  # noqa: PLW0603
    if _worker_task is None or _worker_task.done():
        return
    _worker_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await _worker_task
    _worker_task = None
    logger.info("Firehose delivery worker stopped")


async def _worker_loop(
    database_url: str,
    *,
    database_backend: str | None,
    poll_seconds: float,
    lease_seconds: int,
    batch_size: int,
) -> None:
    """Poll the delivery outbox until the worker is cancelled."""
    worker_id = f"firehose-worker-{uuid.uuid4().hex[:8]}"
    while True:
        try:
            conn = await get_db_connection(database_url, backend=database_backend)
            try:
                result = await process_due_observation_deliveries(
                    conn,
                    worker_id=worker_id,
                    now=db.now_iso(),
                    lease_seconds=lease_seconds,
                    limit=batch_size,
                )
                if result.processed:
                    logger.info(
                        "Processed %d Firehose delivery(s): %d delivered, %d failed",
                        result.processed,
                        result.delivered,
                        result.failed,
                    )
            finally:
                await conn.close()
            await asyncio.sleep(poll_seconds)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Firehose delivery worker encountered an unexpected error")
            await asyncio.sleep(poll_seconds)
