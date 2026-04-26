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
                id, location_query, state, issue_areas, started_at, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (run_id, location_query, state, db.encode_json(issue_areas), now, "running", now),
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
        }

        fields_to_update = {k: v for k, v in kwargs.items() if k in allowed_fields}
        if not fields_to_update:
            return False

        set_clause = ", ".join([f"{k} = ?" for k in fields_to_update])
        values = [*list(fields_to_update.values()), run_id]

        cursor = await conn.execute(
            f"UPDATE discovery_runs SET {set_clause} WHERE id = ?",
            values,
        )
        await conn.commit()
        return cursor.rowcount > 0

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
    return DiscoveryRunModel(
        id=row["id"],
        location_query=row["location_query"],
        state=row["state"],
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
    created_at: str
    started_at: str | None
    completed_at: str | None


class DiscoveryJobCRUD:
    """CRUD operations for discovery pipeline jobs."""

    @staticmethod
    async def create(
        conn: aiosqlite.Connection,
        *,
        run_id: str,
        max_retries: int = 2,
    ) -> str:
        """Create a new job in queued status. Returns the job ID."""
        job_id = db.generate_uuid()
        now = db.now_iso()
        await conn.execute(
            """
            INSERT INTO discovery_jobs (
                id, run_id, status, retry_count, max_retries, created_at
            ) VALUES (?, ?, 'queued', 0, ?, ?)
            """,
            (job_id, run_id, max_retries, now),
        )
        await conn.commit()
        return job_id

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
    ) -> DiscoveryJobModel | None:
        """Claim the oldest queued job or a stale claimed job. Returns None if none available."""
        now = db.now_iso()
        cursor = await conn.execute(
            """
            SELECT * FROM discovery_jobs
            WHERE status = 'queued'
               OR (status = 'claimed' AND claimed_until < ?)
            ORDER BY created_at ASC
            LIMIT 1
            """,
            (now,),
        )
        row = await cursor.fetchone()
        if not row:
            return None

        columns = [col[0] for col in cursor.description]
        job = _row_to_discovery_job(dict(zip(columns, row, strict=False)))

        from datetime import UTC, datetime, timedelta

        lease_until = (datetime.now(UTC) + timedelta(seconds=lease_seconds)).isoformat()
        await conn.execute(
            """
            UPDATE discovery_jobs
            SET status = 'claimed', claimed_by = ?, claimed_until = ?, started_at = COALESCE(started_at, ?)
            WHERE id = ?
            """,
            (claimed_by, lease_until, now, job.id),
        )
        await conn.commit()

        job.status = "claimed"
        job.claimed_by = claimed_by
        job.claimed_until = lease_until
        return job

    @staticmethod
    async def update_progress(
        conn: aiosqlite.Connection,
        job_id: str,
        progress: dict[str, Any],
    ) -> None:
        """Update the job progress JSON."""
        await conn.execute(
            "UPDATE discovery_jobs SET status = 'running', progress = ? WHERE id = ?",
            (db.encode_json(progress), job_id),
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
    ) -> bool:
        """Mark a job as failed, or re-queue if retries remain. Returns True if re-queued."""
        job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        if job is None:
            return False

        new_retry = job.retry_count + 1
        if new_retry <= job.max_retries:
            await conn.execute(
                """
                UPDATE discovery_jobs
                SET status = 'queued', retry_count = ?, error_message = ?,
                    claimed_by = NULL, claimed_until = NULL
                WHERE id = ?
                """,
                (new_retry, error_message, job_id),
            )
            await conn.commit()
            return True

        now = db.now_iso()
        await conn.execute(
            """
            UPDATE discovery_jobs
            SET status = 'failed', retry_count = ?, error_message = ?, completed_at = ?
            WHERE id = ?
            """,
            (new_retry, error_message, now, job_id),
        )
        await conn.commit()
        return False

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
        created_at=row["created_at"],
        started_at=row.get("started_at"),
        completed_at=row.get("completed_at"),
    )
