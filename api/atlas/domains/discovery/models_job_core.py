"""Discovery job models, queue inputs, and creation helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import aiosqlite

from atlas.platform.database import db


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
    execution_mode: str
    input_payload: dict[str, Any]
    created_at: str
    started_at: str | None
    completed_at: str | None


@dataclass
class DiscoveryJobQueueItemModel(DiscoveryJobModel):
    """A durable discovery job with its research target context."""

    location_query: str
    state: str
    issue_areas: list[str]


@dataclass(frozen=True)
class DiscoveryJobInput:
    """Mode-specific instructions for a queued discovery job."""

    execution_mode: str = "search"
    payload: dict[str, Any] | None = None


class DiscoveryJobCRUDCore:
    """CRUD operations for discovery pipeline jobs."""

    @staticmethod
    async def create(
        conn: aiosqlite.Connection,
        *,
        run_id: str,
        max_retries: int = 2,
        idempotency_key: str | None = None,
        job_input: DiscoveryJobInput | None = None,
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
        job_input : DiscoveryJobInput | None, optional
            Mode-specific worker instructions. Default is a search job.

        Returns
        -------
        str
            The new job's id, or the existing job's id on a duplicate key.
        """
        if idempotency_key is not None:
            existing = await DiscoveryJobCRUDCore._get_by_idempotency_key(conn, idempotency_key)
            if existing is not None:
                return existing

        job_id = db.generate_uuid()
        now = db.now_iso()
        create_input = job_input or DiscoveryJobInput()
        await conn.execute(
            """
            INSERT INTO discovery_jobs (
                id, run_id, status, retry_count, max_retries,
                idempotency_key, execution_mode, input_payload, created_at
            ) VALUES (?, ?, 'queued', 0, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                run_id,
                max_retries,
                idempotency_key,
                create_input.execution_mode,
                db.encode_json(create_input.payload or {}),
                now,
            ),
        )
        await conn.commit()
        return job_id

    @staticmethod
    async def _get_by_idempotency_key(
        conn: aiosqlite.Connection, idempotency_key: str
    ) -> str | None:
        """Return the id of an existing job sharing this idempotency key."""
        job = await DiscoveryJobCRUDCore.get_by_idempotency_key(conn, idempotency_key)
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


def _job_input_payload(row: dict[str, Any]) -> dict[str, Any]:
    """Decode job input payloads from SQLite text or Postgres JSONB values."""
    raw_payload = row.get("input_payload")
    if isinstance(raw_payload, dict):
        return raw_payload
    if raw_payload:
        decoded = db.decode_json(str(raw_payload))
        return decoded if isinstance(decoded, dict) else {}
    return {}


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
        execution_mode=str(row.get("execution_mode") or "search"),
        input_payload=_job_input_payload(row),
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
        execution_mode=job.execution_mode,
        input_payload=job.input_payload,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        location_query=str(row["location_query"]),
        state=str(row["state"]),
        issue_areas=db.decode_json(row["issue_areas"]),  # type: ignore[arg-type]
    )
