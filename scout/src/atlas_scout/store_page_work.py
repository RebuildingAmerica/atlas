"""Page-task, extraction-cache, and work-claim mixin for Atlas Scout."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from atlas_scout.store_core import _new_id, _now


class ScoutStorePageWorkMixin:
    async def create_page_task(self, run_id: str, url: str) -> str:
        """Create a page task in queued status and return its ID."""
        task_id = _new_id()
        now = _now()
        await self._execute(
            """
            INSERT INTO page_tasks (id, run_id, url, status, created_at, updated_at)
            VALUES (?, ?, ?, 'queued', ?, ?)
            """,
            (task_id, run_id, url, now, now),
        )
        return task_id

    async def update_page_task(
        self,
        task_id: str,
        status: str,
        *,
        error: str | None = None,
        entries_extracted: int | None = None,
    ) -> None:
        """Update a page task status and optional result fields."""
        parts = ["status = ?", "updated_at = ?"]
        params: list[Any] = [status, _now()]
        if error is not None:
            parts.append("error = ?")
            params.append(error)
        if entries_extracted is not None:
            parts.append("entries_extracted = ?")
            params.append(entries_extracted)
        params.append(task_id)
        await self._execute(
            f"UPDATE page_tasks SET {', '.join(parts)} WHERE id = ?",
            tuple(params),
        )

    async def list_page_tasks(self, run_id: str) -> list[dict[str, Any]]:
        """Return page tasks for one run ordered by creation time."""
        assert self._conn is not None
        async with self._conn.execute(
            "SELECT * FROM page_tasks WHERE run_id = ? ORDER BY created_at",
            (run_id,),
        ) as cursor:
            rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def list_all_page_tasks(self, limit: int = 100) -> list[dict[str, Any]]:
        """Return recent page tasks across all runs."""
        assert self._conn is not None
        async with self._conn.execute(
            "SELECT * FROM page_tasks ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        ) as cursor:
            rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def get_page_task_summary(self, run_id: str) -> dict[str, int]:
        """Return counts of page tasks by status for a run."""
        assert self._conn is not None
        async with self._conn.execute(
            "SELECT status, COUNT(*) AS cnt FROM page_tasks WHERE run_id = ? GROUP BY status",
            (run_id,),
        ) as cursor:
            rows = await cursor.fetchall()
        return {row["status"]: row["cnt"] for row in rows}

    # ------------------------------------------------------------------
    # Extraction cache
    # ------------------------------------------------------------------

    async def get_cached_extraction(self, cache_key: str) -> dict[str, Any] | None:
        """Return a cached extraction result if present."""
        assert self._conn is not None
        async with self._conn.execute(
            "SELECT * FROM extractions WHERE cache_key = ?",
            (cache_key,),
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            return None
        result = dict(row)
        result["entries"] = json.loads(result["entries"])
        return result

    async def cache_extraction(
        self,
        *,
        cache_key: str,
        source_fingerprint: str,
        provider_key: str,
        prompt_key: str,
        entries: list[dict[str, Any]],
    ) -> None:
        """Insert or replace a structured extraction result."""
        await self._execute(
            """
            INSERT OR REPLACE INTO extractions
                (cache_key, source_fingerprint, provider_key, prompt_key, entries, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                cache_key,
                source_fingerprint,
                provider_key,
                prompt_key,
                json.dumps(entries),
                _now(),
            ),
        )

    # ------------------------------------------------------------------
    # Cross-run work claims
    # ------------------------------------------------------------------

    async def claim_work(
        self,
        key: str,
        *,
        owner_run_id: str,
        lease_seconds: int = 120,
    ) -> bool:
        """Attempt to claim a work unit. Returns True only for the winning claimant."""
        assert self._conn is not None
        now = datetime.now(UTC)
        now_iso = now.isoformat()

        existing_claim = await self.get_work_claim(key)
        if (
            existing_claim is not None
            and existing_claim.get("status") == "inflight"
            and existing_claim.get("owner_run_id") != owner_run_id
            and existing_claim.get("lease_expires_at", "") > now_iso
        ):
            current_owner = existing_claim.get("owner_run_id")
            current_owner_status = await self._run_status(str(current_owner or ""))
            if current_owner_status is not None and current_owner_status not in {
                "pending",
                "running",
            }:
                await self.fail_work(key, "reclaimed_from_inactive_run")

        lease_expires_at = (now + timedelta(seconds=lease_seconds)).isoformat()
        await self._execute(
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
        async with self._conn.execute(
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

    async def _run_status(self, run_id: str) -> str | None:
        """Return the owning run status when a real run record exists."""
        if not run_id or run_id == "anonymous":
            return None
        try:
            run = await self.get_run(run_id)
        except KeyError:
            return None
        status = run.get("status")
        return str(status) if status is not None else None

    async def complete_work(self, key: str) -> None:
        """Mark a claimed work unit as completed."""
        await self._execute(
            """
            UPDATE work_claims
            SET status = 'completed',
                lease_expires_at = ?,
                updated_at = ?,
                error = NULL
            WHERE key = ?
            """,
            (_now(), _now(), key),
        )

    async def fail_work(self, key: str, error: str) -> None:
        """Mark a claimed work unit as failed."""
        await self._execute(
            """
            UPDATE work_claims
            SET status = 'failed',
                lease_expires_at = ?,
                updated_at = ?,
                error = ?
            WHERE key = ?
            """,
            (_now(), _now(), error, key),
        )

    async def get_work_claim(self, key: str) -> dict[str, Any] | None:
        """Return the current state of a work claim, if one exists."""
        assert self._conn is not None
        async with self._conn.execute(
            "SELECT * FROM work_claims WHERE key = ?",
            (key,),
        ) as cursor:
            row = await cursor.fetchone()
        return dict(row) if row is not None else None

    # ------------------------------------------------------------------
    # Entries
    # ------------------------------------------------------------------

