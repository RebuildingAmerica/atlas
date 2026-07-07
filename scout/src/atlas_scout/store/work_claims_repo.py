"""Cross-run work-unit leasing: claim/complete/fail with a time-bound lease."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from atlas_scout.store.db import Database

_CREATE_WORK_CLAIMS = """
CREATE TABLE IF NOT EXISTS work_claims (
    key TEXT PRIMARY KEY,
    owner_run_id TEXT NOT NULL,
    status TEXT NOT NULL,
    lease_expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    error TEXT
)
"""

RunStatusLookup = Callable[[str], Awaitable["str | None"]]


class WorkClaimsRepository:
    """Coordinates exclusive claims over a shared work unit across concurrent runs."""

    def __init__(self, db: Database, *, run_status_lookup: RunStatusLookup) -> None:
        self._db = db
        self._run_status_lookup = run_status_lookup

    async def ensure_schema(self) -> None:
        """Create the work_claims table if it doesn't exist."""
        await self._db.connection.execute(_CREATE_WORK_CLAIMS)

    async def claim_work(
        self,
        key: str,
        *,
        owner_run_id: str,
        lease_seconds: int = 120,
    ) -> bool:
        """Attempt to claim a work unit. Returns True only for the winning claimant."""
        conn = self._db.connection
        current_time = datetime.now(UTC)
        now_iso = current_time.isoformat()

        existing_claim = await self.get_work_claim(key)
        if (
            existing_claim is not None
            and existing_claim.get("status") == "inflight"
            and existing_claim.get("owner_run_id") != owner_run_id
            and existing_claim.get("lease_expires_at", "") > now_iso
        ):
            current_owner = existing_claim.get("owner_run_id")
            current_owner_status = await self._run_status_lookup(str(current_owner or ""))
            if current_owner_status is not None and current_owner_status not in {
                "pending",
                "running",
            }:
                await self.fail_work(key, "reclaimed_from_inactive_run")

        lease_expires_at = (current_time + timedelta(seconds=lease_seconds)).isoformat()
        await self._db.execute(
            """
            INSERT INTO work_claims (key, owner_run_id, status, lease_expires_at, updated_at, error)
            VALUES (?, ?, 'inflight', ?, ?, NULL)
            ON CONFLICT(key) DO UPDATE SET
                owner_run_id = excluded.owner_run_id,
                status = 'inflight',
                lease_expires_at = excluded.lease_expires_at,
                updated_at = excluded.updated_at,
                error = NULL
            WHERE work_claims.status != 'inflight'
               OR work_claims.lease_expires_at <= excluded.updated_at
            """,
            (key, owner_run_id, lease_expires_at, now_iso),
        )
        async with conn.execute(
            "SELECT owner_run_id, status, lease_expires_at FROM work_claims WHERE key = ?",
            (key,),
        ) as cursor:
            row = await cursor.fetchone()
        return bool(
            row
            and row["owner_run_id"] == owner_run_id
            and row["status"] == "inflight"
            and row["lease_expires_at"] == lease_expires_at
        )

    async def complete_work(self, key: str) -> None:
        """Mark a claimed work unit as completed."""
        completed_at = datetime.now(UTC).isoformat()
        await self._db.execute(
            """
            UPDATE work_claims
            SET status = 'completed',
                lease_expires_at = ?,
                updated_at = ?,
                error = NULL
            WHERE key = ?
            """,
            (completed_at, completed_at, key),
        )

    async def fail_work(self, key: str, error: str) -> None:
        """Mark a claimed work unit as failed."""
        failed_at = datetime.now(UTC).isoformat()
        await self._db.execute(
            """
            UPDATE work_claims
            SET status = 'failed',
                lease_expires_at = ?,
                updated_at = ?,
                error = ?
            WHERE key = ?
            """,
            (failed_at, failed_at, error, key),
        )

    async def get_work_claim(self, key: str) -> dict[str, Any] | None:
        """Return the current state of a work claim, if one exists."""
        async with self._db.connection.execute(
            "SELECT * FROM work_claims WHERE key = ?",
            (key,),
        ) as cursor:
            row = await cursor.fetchone()
        return dict(row) if row is not None else None
