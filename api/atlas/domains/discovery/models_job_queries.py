"""Discovery job queue queries."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import aiosqlite

    from .models_job_core import DiscoveryJobModel, DiscoveryJobQueueItemModel

from .models_job_core import _row_to_discovery_job, _row_to_discovery_job_queue_item


class DiscoveryJobCRUDQueries:
    """Discovery job queue query helpers."""

    @staticmethod
    async def list_by_status(
        conn: aiosqlite.Connection,
        status: str,
        *,
        limit: int = 50,
    ) -> list[DiscoveryJobModel]:
        """List jobs by status."""
        cursor = await conn.execute(
            "SELECT * FROM discovery_jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?",
            (status, limit),
        )
        rows = await cursor.fetchall()
        if not rows:
            return []
        columns = [col[0] for col in cursor.description]
        return [_row_to_discovery_job(dict(zip(columns, row, strict=False))) for row in rows]

    @staticmethod
    async def count_by_status(conn: aiosqlite.Connection) -> dict[str, int]:
        """Count jobs grouped by status.

        Aggregates with SQL so the totals are exact regardless of how many jobs
        share a status, unlike listing rows under a page cap.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.

        Returns
        -------
        dict[str, int]
            A mapping of each present status to its job count; statuses with no
            jobs are absent.
        """
        cursor = await conn.execute("SELECT status, COUNT(*) FROM discovery_jobs GROUP BY status")
        rows = await cursor.fetchall()
        return {str(row[0]): int(row[1]) for row in rows}

    @staticmethod
    async def list_queue(
        conn: aiosqlite.Connection,
        *,
        limit: int = 25,
    ) -> list[DiscoveryJobQueueItemModel]:
        """List recent active or failed jobs with research target context."""
        cursor = await conn.execute(
            """
            SELECT
                j.id,
                j.run_id,
                j.status,
                j.progress,
                j.error_message,
                j.retry_count,
                j.max_retries,
                j.claimed_by,
                j.claimed_until,
                j.idempotency_key,
                j.next_attempt_at,
                j.execution_mode,
                j.input_payload,
                j.created_at,
                j.started_at,
                j.completed_at,
                r.location_query,
                r.state,
                r.issue_areas
            FROM discovery_jobs j
            JOIN discovery_runs r ON r.id = j.run_id
            WHERE j.status IN ('queued', 'claimed', 'running', 'failed')
            ORDER BY j.created_at DESC, j.id DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = await cursor.fetchall()
        if not rows:
            return []
        columns = [col[0] for col in cursor.description]
        return [
            _row_to_discovery_job_queue_item(dict(zip(columns, row, strict=False))) for row in rows
        ]
