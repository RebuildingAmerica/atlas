"""
DiscoveryRun model and CRUD operations.

Tracks pipeline execution for auditability and enables re-runs of specific
locations and issue areas.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import aiosqlite

from atlas.platform.database import db

logger = logging.getLogger(__name__)

__all__ = [
    "DiscoveryJobCRUD",
    "DiscoveryJobModel",
    "DiscoveryJobQueueItemModel",
    "DiscoveryRunCRUD",
    "DiscoveryRunModel",
    "DiscoveryRunSyncCRUD",
    "DiscoveryRunSyncModel",
    "DiscoveryScheduleCRUD",
    "DiscoveryScheduleModel",
]


@dataclass
class DiscoveryRunModel:
    """DiscoveryRun data model."""

    id: str
    location_query: str
    state: str
    research_goal: str
    issue_areas: list[str]
    queries_generated: int
    sources_fetched: int
    sources_processed: int
    entries_extracted: int
    entries_after_dedup: int
    entries_confirmed: int
    started_at: str
    completed_at: str | None
    status: str
    error_message: str | None
    created_at: str
    research_summary: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        """
        Convert discovery run to dictionary.

        Returns
        -------
        dict[str, Any]
            Discovery run as dictionary.
        """
        return {
            "id": self.id,
            "location_query": self.location_query,
            "state": self.state,
            "research_goal": self.research_goal,
            "issue_areas": self.issue_areas,
            "queries_generated": self.queries_generated,
            "sources_fetched": self.sources_fetched,
            "sources_processed": self.sources_processed,
            "entries_extracted": self.entries_extracted,
            "entries_after_dedup": self.entries_after_dedup,
            "entries_confirmed": self.entries_confirmed,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "status": self.status,
            "error_message": self.error_message,
            "created_at": self.created_at,
            "research_summary": self.research_summary,
        }


@dataclass
class DiscoveryRunSyncModel:
    """Idempotent sync record linking a local runner bundle to an Atlas run."""

    id: str
    local_run_id: str
    artifact_hash: str
    remote_run_id: str
    actor_user_id: str
    actor_email: str | None
    sync_status: str
    created_at: str
    synced_at: str | None


class DiscoveryRunCRUD:
    """CRUD operations for discovery runs."""

    @staticmethod
    async def create(
        conn: aiosqlite.Connection,
        location_query: str,
        state: str,
        issue_areas: list[str],
        research_goal: str = "landscape_scan",
    ) -> str:
        """
        Create a new discovery run.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        location_query : str
            Location query (e.g., "Kansas City, MO").
        state : str
            2-letter state code.
        issue_areas : list[str]
            List of issue area slugs being queried.
        research_goal : str, optional
            Research job this run is meant to support. Default is "landscape_scan".

        Returns
        -------
        str
            The created discovery run ID.
        """
        run_id = db.generate_uuid()
        now = db.now_iso()

        await conn.execute(
            """
            INSERT INTO discovery_runs (
                id, location_query, state, issue_areas, research_goal, started_at, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                location_query,
                state,
                db.encode_json(issue_areas),
                research_goal,
                now,
                "running",
                now,
            ),
        )
        await conn.commit()
        return run_id

    @staticmethod
    async def get_by_id(conn: aiosqlite.Connection, run_id: str) -> DiscoveryRunModel | None:
        """
        Get a discovery run by ID.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        run_id : str
            Discovery run ID.

        Returns
        -------
        DiscoveryRunModel | None
            The discovery run if found, None otherwise.
        """
        cursor = await conn.execute("SELECT * FROM discovery_runs WHERE id = ?", (run_id,))
        row = await cursor.fetchone()
        if not row:
            return None

        columns = [col[0] for col in cursor.description]
        data = dict(zip(columns, row, strict=False))
        return _row_to_discovery_run(data)

    @staticmethod
    async def list(
        conn: aiosqlite.Connection,
        state: str | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[DiscoveryRunModel]:
        """
        List discovery runs with optional filtering.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        state : str | None, optional
            Filter by state. Default is None.
        status : str | None, optional
            Filter by status (running, completed, failed). Default is None.
        limit : int, optional
            Result limit. Default is 50.
        offset : int, optional
            Result offset. Default is 0.

        Returns
        -------
        list[DiscoveryRunModel]
            List of discovery runs.
        """
        query = "SELECT * FROM discovery_runs WHERE 1=1"
        params: list[Any] = []

        if state:
            query += " AND state = ?"
            params.append(state)
        if status:
            query += " AND status = ?"
            params.append(status)

        query += " ORDER BY started_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor = await conn.execute(query, params)
        rows = await cursor.fetchall()

        if not rows:
            return []

        columns = [col[0] for col in cursor.description]
        return [_row_to_discovery_run(dict(zip(columns, row, strict=False))) for row in rows]

    @staticmethod
    async def count(
        conn: aiosqlite.Connection,
        state: str | None = None,
        status: str | None = None,
    ) -> int:
        """Count discovery runs with optional filtering."""
        query = "SELECT COUNT(*) FROM discovery_runs WHERE 1=1"
        params: list[Any] = []
        if state:
            query += " AND state = ?"
            params.append(state)
        if status:
            query += " AND status = ?"
            params.append(status)
        cursor = await conn.execute(query, params)
        row = await cursor.fetchone()
        return int(row[0] or 0) if row else 0

    @staticmethod
    async def update(
        conn: aiosqlite.Connection,
        run_id: str,
        **kwargs: object,
    ) -> bool:
        """
        Update a discovery run.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        run_id : str
            Discovery run ID.
        **kwargs : object
            Fields to update.

        Returns
        -------
        bool
            True if updated, False if not found.
        """
        allowed_fields = {
            "queries_generated",
            "sources_fetched",
            "sources_processed",
            "entries_extracted",
            "entries_after_dedup",
            "entries_confirmed",
            "completed_at",
            "status",
            "error_message",
            "research_summary",
        }

        fields_to_update = {k: v for k, v in kwargs.items() if k in allowed_fields}
        if not fields_to_update:
            return False

        if "research_summary" in fields_to_update:
            fields_to_update["research_summary"] = db.encode_json(
                fields_to_update["research_summary"]
            )

        set_clause = ", ".join([f"{k} = ?" for k in fields_to_update])
        values = [*list(fields_to_update.values()), run_id]

        cursor = await conn.execute(
            f"UPDATE discovery_runs SET {set_clause} WHERE id = ?",
            values,
        )
        await conn.commit()
        return cursor.rowcount > 0

    @staticmethod
    async def update_research_summary(
        conn: aiosqlite.Connection,
        run_id: str,
        research_summary: dict[str, Any],
    ) -> bool:
        """
        Persist the structured research output for a discovery run.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        run_id : str
            Discovery run ID.
        research_summary : dict[str, Any]
            Source-linked brief, ranked leads, gaps, and reasoning signals.

        Returns
        -------
        bool
            True if updated, False if not found.
        """
        return await DiscoveryRunCRUD.update(
            conn,
            run_id,
            research_summary=research_summary,
        )

    @staticmethod
    async def complete(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        run_id: str,
        queries_generated: int = 0,
        sources_fetched: int = 0,
        sources_processed: int = 0,
        entries_extracted: int = 0,
        entries_after_dedup: int = 0,
        entries_confirmed: int = 0,
    ) -> bool:
        """
        Mark a discovery run as completed.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        run_id : str
            Discovery run ID.
        queries_generated : int, optional
            Number of search queries generated. Default is 0.
        sources_fetched : int, optional
            Number of sources fetched. Default is 0.
        sources_processed : int, optional
            Number of sources processed. Default is 0.
        entries_extracted : int, optional
            Number of entries extracted. Default is 0.
        entries_after_dedup : int, optional
            Number of entries after deduplication. Default is 0.
        entries_confirmed : int, optional
            Number of entries confirmed. Default is 0.

        Returns
        -------
        bool
            True if updated, False if not found.
        """
        return await DiscoveryRunCRUD.update(
            conn,
            run_id,
            status="completed",
            completed_at=db.now_iso(),
            queries_generated=queries_generated,
            sources_fetched=sources_fetched,
            sources_processed=sources_processed,
            entries_extracted=entries_extracted,
            entries_after_dedup=entries_after_dedup,
            entries_confirmed=entries_confirmed,
        )

    @staticmethod
    async def fail(
        conn: aiosqlite.Connection,
        run_id: str,
        error_message: str,
    ) -> bool:
        """
        Mark a discovery run as failed.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        run_id : str
            Discovery run ID.
        error_message : str
            Error message.

        Returns
        -------
        bool
            True if updated, False if not found.
        """
        return await DiscoveryRunCRUD.update(
            conn,
            run_id,
            status="failed",
            error_message=error_message,
            completed_at=db.now_iso(),
        )


class DiscoveryRunSyncCRUD:
    """CRUD helpers for discovery bundle sync records."""

    @staticmethod
    async def get_by_identity(
        conn: aiosqlite.Connection,
        *,
        local_run_id: str,
        artifact_hash: str,
    ) -> DiscoveryRunSyncModel | None:
        """Return an existing sync row for a local bundle identity, if present."""
        cursor = await conn.execute(
            """
            SELECT *
            FROM discovery_run_syncs
            WHERE local_run_id = ? AND artifact_hash = ?
            """,
            (local_run_id, artifact_hash),
        )
        row = await cursor.fetchone()
        if not row:
            return None

        columns = [col[0] for col in cursor.description]
        return _row_to_discovery_run_sync(dict(zip(columns, row, strict=False)))

    @staticmethod
    async def create(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        *,
        local_run_id: str,
        artifact_hash: str,
        remote_run_id: str,
        actor_user_id: str,
        actor_email: str | None,
        sync_status: str,
    ) -> str:
        """Create a durable sync record for a successfully replayed bundle."""
        sync_id = db.generate_uuid()
        now = db.now_iso()
        await conn.execute(
            """
            INSERT INTO discovery_run_syncs (
                id,
                local_run_id,
                artifact_hash,
                remote_run_id,
                actor_user_id,
                actor_email,
                sync_status,
                created_at,
                synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sync_id,
                local_run_id,
                artifact_hash,
                remote_run_id,
                actor_user_id,
                actor_email,
                sync_status,
                now,
                now,
            ),
        )
        await conn.commit()
        return sync_id


def _row_to_discovery_run(row: dict[str, Any]) -> DiscoveryRunModel:
    """Convert database row to DiscoveryRunModel."""
    research_summary = row.get("research_summary")
    return DiscoveryRunModel(
        id=row["id"],
        location_query=row["location_query"],
        state=row["state"],
        research_goal=row.get("research_goal", "landscape_scan"),
        issue_areas=db.decode_json(row["issue_areas"]),  # type: ignore[arg-type]
        queries_generated=row["queries_generated"],
        sources_fetched=row["sources_fetched"],
        sources_processed=row["sources_processed"],
        entries_extracted=row["entries_extracted"],
        entries_after_dedup=row["entries_after_dedup"],
        entries_confirmed=row["entries_confirmed"],
        started_at=row["started_at"],
        completed_at=row["completed_at"],
        status=row["status"],
        error_message=row["error_message"],
        created_at=row["created_at"],
        research_summary=(
            db.decode_json(research_summary)  # type: ignore[arg-type]
            if research_summary
            else None
        ),
    )


def _row_to_discovery_run_sync(row: dict[str, Any]) -> DiscoveryRunSyncModel:
    """Convert database row to DiscoveryRunSyncModel."""
    return DiscoveryRunSyncModel(
        id=row["id"],
        local_run_id=row["local_run_id"],
        artifact_hash=row["artifact_hash"],
        remote_run_id=row["remote_run_id"],
        actor_user_id=row["actor_user_id"],
        actor_email=row["actor_email"],
        sync_status=row["sync_status"],
        created_at=row["created_at"],
        synced_at=row["synced_at"],
    )


@dataclass
class DiscoveryScheduleModel:
    """A scheduled discovery target."""

    id: str
    location_query: str
    state: str
    issue_areas: list[str]
    search_depth: str
    enabled: bool
    last_run_id: str | None
    last_run_at: str | None
    created_at: str
    updated_at: str


class DiscoveryScheduleCRUD:
    """CRUD operations for discovery schedule targets."""

    @staticmethod
    async def create(
        conn: aiosqlite.Connection,
        *,
        location_query: str,
        state: str,
        issue_areas: list[str],
        search_depth: str = "standard",
    ) -> str:
        """Create a new schedule target. Returns the schedule ID."""
        schedule_id = db.generate_uuid()
        now = db.now_iso()
        await conn.execute(
            """
            INSERT INTO discovery_schedules (
                id, location_query, state, issue_areas, search_depth,
                enabled, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                schedule_id,
                location_query,
                state,
                db.encode_json(issue_areas),
                search_depth,
                now,
                now,
            ),
        )
        await conn.commit()
        return schedule_id

    @staticmethod
    async def get_by_id(
        conn: aiosqlite.Connection, schedule_id: str
    ) -> DiscoveryScheduleModel | None:
        """Get a schedule target by ID."""
        cursor = await conn.execute(
            "SELECT * FROM discovery_schedules WHERE id = ?", (schedule_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return None
        columns = [col[0] for col in cursor.description]
        return _row_to_discovery_schedule(dict(zip(columns, row, strict=False)))

    @staticmethod
    async def list(
        conn: aiosqlite.Connection,
        *,
        enabled_only: bool = False,
        limit: int = 100,
    ) -> list[DiscoveryScheduleModel]:
        """List schedule targets."""
        query = "SELECT * FROM discovery_schedules"
        params: list[Any] = []
        if enabled_only:
            query += " WHERE enabled = 1"
        query += " ORDER BY created_at ASC LIMIT ?"
        params.append(limit)
        cursor = await conn.execute(query, params)
        rows = await cursor.fetchall()
        if not rows:
            return []
        columns = [col[0] for col in cursor.description]
        return [_row_to_discovery_schedule(dict(zip(columns, row, strict=False))) for row in rows]

    @staticmethod
    async def update(
        conn: aiosqlite.Connection,
        schedule_id: str,
        **kwargs: object,
    ) -> bool:
        """Update a schedule target. Returns True if updated."""
        allowed_fields = {
            "location_query",
            "state",
            "issue_areas",
            "search_depth",
            "enabled",
            "last_run_id",
            "last_run_at",
        }
        fields_to_update = {k: v for k, v in kwargs.items() if k in allowed_fields}
        if not fields_to_update:
            return False

        if "issue_areas" in fields_to_update:
            fields_to_update["issue_areas"] = db.encode_json(fields_to_update["issue_areas"])
        if "enabled" in fields_to_update:
            fields_to_update["enabled"] = 1 if fields_to_update["enabled"] else 0

        fields_to_update["updated_at"] = db.now_iso()
        set_clause = ", ".join([f"{k} = ?" for k in fields_to_update])
        values = [*list(fields_to_update.values()), schedule_id]
        cursor = await conn.execute(
            f"UPDATE discovery_schedules SET {set_clause} WHERE id = ?",
            values,
        )
        await conn.commit()
        return cursor.rowcount > 0

    @staticmethod
    async def delete(conn: aiosqlite.Connection, schedule_id: str) -> bool:
        """Delete a schedule target. Returns True if deleted."""
        cursor = await conn.execute("DELETE FROM discovery_schedules WHERE id = ?", (schedule_id,))
        await conn.commit()
        return cursor.rowcount > 0


def _row_to_discovery_schedule(row: dict[str, Any]) -> DiscoveryScheduleModel:
    """Convert database row to DiscoveryScheduleModel."""
    enabled_raw = row["enabled"]
    enabled = bool(enabled_raw) if isinstance(enabled_raw, int) else enabled_raw is True
    return DiscoveryScheduleModel(
        id=row["id"],
        location_query=row["location_query"],
        state=row["state"],
        issue_areas=db.decode_json(row["issue_areas"]),  # type: ignore[arg-type]
        search_depth=row["search_depth"],
        enabled=enabled,
        last_run_id=row.get("last_run_id"),
        last_run_at=row.get("last_run_at"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@dataclass
class DiscoveryJobModel:
    """A durable discovery pipeline job."""

    id: str
    run_id: str
    status: str
    progress: dict[str, Any] | None
    error_message: str | None
    retry_count: int
    max_retries: int
    claimed_by: str | None
    claimed_until: str | None
    idempotency_key: str | None
    next_attempt_at: str | None
    created_at: str
    started_at: str | None
    completed_at: str | None


@dataclass
class DiscoveryJobQueueItemModel(DiscoveryJobModel):
    """A durable discovery job with its research target context."""

    location_query: str
    state: str
    issue_areas: list[str]


class DiscoveryJobCRUD:
    """CRUD operations for discovery pipeline jobs."""

    @staticmethod
    async def create(
        conn: aiosqlite.Connection,
        *,
        run_id: str,
        max_retries: int = 2,
        idempotency_key: str | None = None,
    ) -> str:
        """Create a new job in queued status. Returns the job ID.

        When ``idempotency_key`` is supplied and a job with that key already
        exists, the insert is a no-op and the existing job's id is returned, so
        re-enqueueing the same target is safe.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        run_id : str
            Owning discovery run id.
        max_retries : int, optional
            Maximum retry attempts. Default is 2.
        idempotency_key : str | None, optional
            Unique key making re-enqueue a no-op. Default is None.

        Returns
        -------
        str
            The new job's id, or the existing job's id on a duplicate key.
        """
        if idempotency_key is not None:
            existing = await DiscoveryJobCRUD._get_by_idempotency_key(conn, idempotency_key)
            if existing is not None:
                return existing

        job_id = db.generate_uuid()
        now = db.now_iso()
        await conn.execute(
            """
            INSERT INTO discovery_jobs (
                id, run_id, status, retry_count, max_retries,
                idempotency_key, created_at
            ) VALUES (?, ?, 'queued', 0, ?, ?, ?)
            """,
            (job_id, run_id, max_retries, idempotency_key, now),
        )
        await conn.commit()
        return job_id

    @staticmethod
    async def _get_by_idempotency_key(
        conn: aiosqlite.Connection, idempotency_key: str
    ) -> str | None:
        """Return the id of an existing job sharing this idempotency key."""
        job = await DiscoveryJobCRUD.get_by_idempotency_key(conn, idempotency_key)
        return job.id if job is not None else None

    @staticmethod
    async def get_by_idempotency_key(
        conn: aiosqlite.Connection, idempotency_key: str
    ) -> DiscoveryJobModel | None:
        """Return the job sharing this idempotency key, or None.

        Lets a scheduled trigger reuse the job (and its run) already enqueued for
        the same target on the same day instead of stranding a fresh run.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        idempotency_key : str
            The unique key carried by the enqueued job.

        Returns
        -------
        DiscoveryJobModel | None
            The matching job, or None when no job carries the key.
        """
        cursor = await conn.execute(
            "SELECT * FROM discovery_jobs WHERE idempotency_key = ?",
            (idempotency_key,),
        )
        row = await cursor.fetchone()
        if not row:
            return None
        columns = [col[0] for col in cursor.description]
        return _row_to_discovery_job(dict(zip(columns, row, strict=False)))

    @staticmethod
    async def get_by_id(conn: aiosqlite.Connection, job_id: str) -> DiscoveryJobModel | None:
        """Get a job by ID."""
        cursor = await conn.execute("SELECT * FROM discovery_jobs WHERE id = ?", (job_id,))
        row = await cursor.fetchone()
        if not row:
            return None
        columns = [col[0] for col in cursor.description]
        return _row_to_discovery_job(dict(zip(columns, row, strict=False)))

    @staticmethod
    async def get_by_run_id(conn: aiosqlite.Connection, run_id: str) -> DiscoveryJobModel | None:
        """Get the job associated with a run."""
        cursor = await conn.execute(
            "SELECT * FROM discovery_jobs WHERE run_id = ? ORDER BY created_at DESC LIMIT 1",
            (run_id,),
        )
        row = await cursor.fetchone()
        if not row:
            return None
        columns = [col[0] for col in cursor.description]
        return _row_to_discovery_job(dict(zip(columns, row, strict=False)))

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
        capability_clause = (
            ""
            if search_key_configured
            else "AND COALESCE(r.location_query, '') = '' AND r.issue_areas = '[]'"
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
            "UPDATE discovery_jobs SET status = 'completed', completed_at = ? WHERE id = ?",
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
        job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        if job is None:
            return False

        new_retry = job.retry_count + 1
        if retryable and new_retry <= job.max_retries:
            next_attempt_at = _retry_backoff_at(job_id, new_retry)
            await conn.execute(
                """
                UPDATE discovery_jobs
                SET status = 'queued', retry_count = ?, error_message = ?,
                    claimed_by = NULL, claimed_until = NULL, next_attempt_at = ?
                WHERE id = ?
                """,
                (new_retry, error_message, next_attempt_at, job_id),
            )
            await conn.commit()
            return True

        now = db.now_iso()
        await conn.execute(
            """
            UPDATE discovery_jobs
            SET status = 'failed', retry_count = ?, error_message = ?, completed_at = ?,
                claimed_by = NULL, claimed_until = NULL, next_attempt_at = NULL
            WHERE id = ?
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


_MAX_BACKOFF_SECONDS = 300
_JITTER_BUCKETS = 5


def _retry_backoff_at(job_id: str, retry_count: int) -> str:
    """Return the ISO timestamp a retry may next be claimed.

    The base delay is a capped exponential (``2 ** retry_count`` seconds, capped
    at five minutes). A small deterministic jitter derived from the job id
    spreads simultaneous retries out without the non-determinism of ``random``,
    keeping the value reproducible for tests.

    Parameters
    ----------
    job_id : str
        The job's id; seeds the deterministic jitter.
    retry_count : int
        The attempt number the backoff is being computed for.

    Returns
    -------
    str
        ISO-8601 UTC timestamp of the earliest next attempt.
    """
    from datetime import UTC, datetime, timedelta

    base = min(_MAX_BACKOFF_SECONDS, 2**retry_count)
    jitter = abs(hash(job_id)) % _JITTER_BUCKETS
    delay = base + jitter
    return (datetime.now(UTC) + timedelta(seconds=delay)).isoformat()


def _row_to_discovery_job(row: dict[str, Any]) -> DiscoveryJobModel:
    """Convert database row to DiscoveryJobModel."""
    progress_raw = row.get("progress")
    progress = db.decode_json(str(progress_raw)) if progress_raw else None
    return DiscoveryJobModel(
        id=row["id"],
        run_id=row["run_id"],
        status=row["status"],
        progress=progress,  # type: ignore[arg-type]
        error_message=row.get("error_message"),
        retry_count=row["retry_count"],
        max_retries=row["max_retries"],
        claimed_by=row.get("claimed_by"),
        claimed_until=row.get("claimed_until"),
        idempotency_key=row.get("idempotency_key"),
        next_attempt_at=row.get("next_attempt_at"),
        created_at=row["created_at"],
        started_at=row.get("started_at"),
        completed_at=row.get("completed_at"),
    )


def _row_to_discovery_job_queue_item(row: dict[str, Any]) -> DiscoveryJobQueueItemModel:
    """Convert database row to DiscoveryJobQueueItemModel."""
    job = _row_to_discovery_job(row)
    return DiscoveryJobQueueItemModel(
        id=job.id,
        run_id=job.run_id,
        status=job.status,
        progress=job.progress,
        error_message=job.error_message,
        retry_count=job.retry_count,
        max_retries=job.max_retries,
        claimed_by=job.claimed_by,
        claimed_until=job.claimed_until,
        idempotency_key=job.idempotency_key,
        next_attempt_at=job.next_attempt_at,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        location_query=str(row["location_query"]),
        state=str(row["state"]),
        issue_areas=db.decode_json(row["issue_areas"]),  # type: ignore[arg-type]
    )
