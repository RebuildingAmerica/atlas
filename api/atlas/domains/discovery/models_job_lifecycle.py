"""Discovery job lifecycle CRUD helpers."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import aiosqlite

    from .models_job_core import DiscoveryJobModel

from atlas.platform.database import db

from .models_job_core import DiscoveryJobCRUDCore, _retry_backoff_at, _row_to_discovery_job


class DiscoveryJobCRUDLifecycle:
    """Discovery job lifecycle CRUD helpers."""

    @staticmethod
    async def claim_next(
        conn: aiosqlite.Connection,
        *,
        claimed_by: str,
        lease_seconds: int = 900,
        search_key_configured: bool = True,
    ) -> DiscoveryJobModel | None:
        """Atomically claim the oldest claimable job. Returns None if none available.

        A job is claimable when it is ``queued`` or a ``claimed`` job whose lease
        has expired, and its ``next_attempt_at`` (the retry-backoff gate) is unset
        or in the past. On Postgres the claim is a single ``FOR UPDATE SKIP
        LOCKED ... RETURNING`` statement so concurrent workers never double-claim;
        on SQLite the writer is serialized and the UPDATE is guarded by the row's
        observed status so a lost race yields None rather than a stolen job.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        claimed_by : str
            Identifier of the claiming worker.
        lease_seconds : int, optional
            Lease duration in seconds. Default is 900.
        search_key_configured : bool, optional
            Whether the worker can claim normal search-backed jobs. Workers
            without search credentials only receive jobs that have no search
            target, which are reserved for seeded/direct/evidence work.

        Returns
        -------
        DiscoveryJobModel | None
            The claimed job, or None when nothing is claimable.
        """
        from datetime import UTC, datetime, timedelta

        is_postgres = getattr(conn, "backend", "sqlite") == "postgres"
        now = db.now_iso()
        lease_until = (datetime.now(UTC) + timedelta(seconds=lease_seconds)).isoformat()
        capability_clause = ""
        if not search_key_configured:
            capability_clause = (
                "AND (j.execution_mode != 'search' "
                "OR (COALESCE(r.location_query, '') = '' AND r.issue_areas = '[]'))"
            )

        if is_postgres:  # pragma: no cover - exercised only against PostgreSQL
            cursor = await conn.execute(
                f"""
                UPDATE discovery_jobs SET status = 'claimed', claimed_by = ?,
                    claimed_until = ?, started_at = COALESCE(started_at, ?)
                WHERE id = (
                    SELECT j.id FROM discovery_jobs j
                    JOIN discovery_runs r ON r.id = j.run_id
                    WHERE (j.status = 'queued' OR (j.status = 'claimed' AND j.claimed_until < ?))
                      AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= ?)
                      {capability_clause}
                    ORDER BY j.created_at ASC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING *
                """,
                (claimed_by, lease_until, now, now, now),
            )
            row = await cursor.fetchone()
            if row is None:
                return None
            columns = [col[0] for col in cursor.description]
            job = _row_to_discovery_job(dict(zip(columns, row, strict=False)))
            await conn.commit()
            return job

        cursor = await conn.execute(
            f"""
            SELECT j.* FROM discovery_jobs j
            JOIN discovery_runs r ON r.id = j.run_id
            WHERE (j.status = 'queued' OR (j.status = 'claimed' AND j.claimed_until < ?))
              AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= ?)
              {capability_clause}
            ORDER BY j.created_at ASC
            LIMIT 1
            """,
            (now, now),
        )
        row = await cursor.fetchone()
        if row is None:
            return None

        columns = [col[0] for col in cursor.description]
        job = _row_to_discovery_job(dict(zip(columns, row, strict=False)))
        update = await conn.execute(
            """
            UPDATE discovery_jobs
            SET status = 'claimed', claimed_by = ?, claimed_until = ?,
                started_at = COALESCE(started_at, ?)
            WHERE id = ? AND status = ?
            """,
            (claimed_by, lease_until, now, job.id, job.status),
        )
        await conn.commit()
        if getattr(update, "rowcount", 0) != 1:
            return None

        job.status = "claimed"
        job.claimed_by = claimed_by
        job.claimed_until = lease_until
        return job

    @staticmethod
    async def update_progress(
        conn: aiosqlite.Connection,
        job_id: str,
        progress: dict[str, Any],
        *,
        lease_seconds: int = 900,
    ) -> None:
        """Update the job progress JSON and renew the lease.

        Reporting progress moves the job into ``running`` and pushes
        ``claimed_until`` forward by ``lease_seconds`` so a job that is healthily
        making progress is never mistaken for a stranded zombie by the reaper.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        job_id : str
            Job id to update.
        progress : dict[str, Any]
            Progress payload to persist as JSON.
        lease_seconds : int, optional
            Lease duration in seconds. Default is 900.
        """
        from datetime import UTC, datetime, timedelta

        lease_until = (datetime.now(UTC) + timedelta(seconds=lease_seconds)).isoformat()
        await conn.execute(
            "UPDATE discovery_jobs SET status = 'running', progress = ?, claimed_until = ? "
            "WHERE id = ?",
            (db.encode_json(progress), lease_until, job_id),
        )
        await conn.commit()

    @staticmethod
    async def complete(conn: aiosqlite.Connection, job_id: str) -> None:
        """Mark a job as completed."""
        now = db.now_iso()
        await conn.execute(
            "UPDATE discovery_jobs SET status = 'completed', completed_at = ? "
            "WHERE id = ? AND status != 'cancelled'",
            (now, job_id),
        )
        await conn.commit()

    @staticmethod
    async def fail(
        conn: aiosqlite.Connection,
        job_id: str,
        error_message: str,
        *,
        retryable: bool = True,
    ) -> bool:
        """Mark a job as failed, or re-queue if retries remain. Returns True if re-queued.

        A re-queued job is gated behind a capped exponential backoff
        (``next_attempt_at``) so a permanently-erroring job backs off rather
        than hot-looping through the worker and burning the queue. ``claim_next``
        only considers jobs whose ``next_attempt_at`` has passed.
        """
        job = await DiscoveryJobCRUDCore.get_by_id(conn, job_id)
        if job is None:
            return False

        new_retry = job.retry_count + 1
        if retryable and new_retry <= job.max_retries:
            next_attempt_at = _retry_backoff_at(job_id, new_retry)
            cursor = await conn.execute(
                """
                UPDATE discovery_jobs
                SET status = 'queued', retry_count = ?, error_message = ?,
                    claimed_by = NULL, claimed_until = NULL, next_attempt_at = ?
                WHERE id = ? AND status != 'cancelled'
                """,
                (new_retry, error_message, next_attempt_at, job_id),
            )
            await conn.commit()
            return getattr(cursor, "rowcount", 0) > 0

        now = db.now_iso()
        await conn.execute(
            """
            UPDATE discovery_jobs
            SET status = 'failed', retry_count = ?, error_message = ?, completed_at = ?,
                claimed_by = NULL, claimed_until = NULL, next_attempt_at = NULL
            WHERE id = ? AND status != 'cancelled'
            """,
            (new_retry, error_message, now, job_id),
        )
        await conn.commit()
        return False

    @staticmethod
    async def release_worker_leases(conn: aiosqlite.Connection, worker_id: str) -> int:
        """Release active leases held by one revoked Scout worker.

        Jobs return to ``queued`` without incrementing retries because the work
        itself did not fail; the trusted host relationship was revoked.
        """
        cursor = await conn.execute(
            """
            UPDATE discovery_jobs
            SET status = 'queued', claimed_by = NULL, claimed_until = NULL,
                error_message = ?, next_attempt_at = NULL
            WHERE claimed_by = ? AND status IN ('claimed', 'running')
            """,
            ("worker revoked: lease released", worker_id),
        )
        await conn.commit()
        return int(getattr(cursor, "rowcount", 0))

    @staticmethod
    async def reap_orphans(
        conn: aiosqlite.Connection,
        *,
        now: str | None = None,
    ) -> int:
        """Requeue or dead-letter jobs whose lease has expired.

        A ``claimed`` or ``running`` job whose ``claimed_until`` is in the past
        was stranded by a crashed or hung worker. Each such job is requeued with
        an incremented ``retry_count`` so a healthy worker picks it up again,
        unless that would exceed ``max_retries`` — in which case it is moved to
        ``failed`` (the dead-letter terminal state) so it stops being retried.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        now : str | None, optional
            ISO timestamp treated as the current time; defaults to the wall
            clock. Injectable so callers can reap deterministically in tests.

        Returns
        -------
        int
            The number of jobs reaped (requeued or dead-lettered).
        """
        cutoff = now if now is not None else db.now_iso()
        cursor = await conn.execute(
            """
            SELECT id, retry_count, max_retries FROM discovery_jobs
            WHERE status IN ('claimed', 'running')
              AND claimed_until IS NOT NULL AND claimed_until < ?
            """,
            (cutoff,),
        )
        rows = list(await cursor.fetchall())
        if not rows:
            return 0

        for row in rows:
            job_id, retry_count, max_retries = row[0], row[1], row[2]
            new_retry = retry_count + 1
            if new_retry <= max_retries:
                await conn.execute(
                    """
                    UPDATE discovery_jobs
                    SET status = 'queued', retry_count = ?,
                        claimed_by = NULL, claimed_until = NULL
                    WHERE id = ?
                    """,
                    (new_retry, job_id),
                )
            else:
                await conn.execute(
                    """
                    UPDATE discovery_jobs
                    SET status = 'failed', retry_count = ?,
                        error_message = ?, completed_at = ?
                    WHERE id = ?
                    """,
                    (new_retry, "lease expired: worker stranded the job", db.now_iso(), job_id),
                )
        await conn.commit()
        return len(rows)

    @staticmethod
    async def cancel(conn: aiosqlite.Connection, job_id: str) -> bool:
        """Cancel a single job. Returns True if it was cancelled.

        Only a job in a non-terminal state (``queued``, ``claimed``, or
        ``running``) can be cancelled; a job that already ``completed``,
        ``failed``, or was ``cancelled`` is left untouched. ``claim_next`` never
        considers ``cancelled`` jobs, so cancellation removes the job from the
        queue.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        job_id : str
            Job id to cancel.

        Returns
        -------
        bool
            True if the job moved to ``cancelled``, False otherwise.
        """
        now = db.now_iso()
        cursor = await conn.execute(
            """
            UPDATE discovery_jobs
            SET status = 'cancelled', completed_at = ?, claimed_by = NULL, claimed_until = NULL
            WHERE id = ? AND status IN ('queued', 'claimed', 'running')
            """,
            (now, job_id),
        )
        await conn.commit()
        return getattr(cursor, "rowcount", 0) > 0

    @staticmethod
    async def cancel_run_jobs(conn: aiosqlite.Connection, run_id: str) -> int:
        """Cancel every non-terminal job belonging to a run. Returns the count.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        run_id : str
            Owning discovery run id.

        Returns
        -------
        int
            The number of jobs moved to ``cancelled``.
        """
        now = db.now_iso()
        cursor = await conn.execute(
            """
            UPDATE discovery_jobs
            SET status = 'cancelled', completed_at = ?, claimed_by = NULL, claimed_until = NULL
            WHERE run_id = ? AND status IN ('queued', 'claimed', 'running')
            """,
            (now, run_id),
        )
        await conn.commit()
        return int(getattr(cursor, "rowcount", 0))
