"""Run, artifact, and page-cache mixin for Atlas Scout."""

from __future__ import annotations

import json
from hashlib import sha256
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from datetime import datetime

from atlas_shared import DiscoveryRunArtifacts, DiscoverySyncInfo, compute_artifact_hash

from atlas_scout.store_core import _new_id, _now


class ScoutStoreRunsMixin:
    async def create_run(
        self,
        *,
        location: str,
        issues: list[str],
        search_depth: str,
    ) -> str:
        """Insert a new run record and return its ID."""
        run_id = _new_id()
        await self._execute(
            """
            INSERT INTO runs (id, location, issues, search_depth, status, created_at)
            VALUES (?, ?, ?, ?, 'pending', ?)
            """,
            (run_id, location, json.dumps(issues), search_depth, _now()),
        )
        return run_id

    async def get_run(self, run_id: str) -> dict[str, Any]:
        """Fetch a run by ID. Raises KeyError if not found."""
        assert self._conn is not None
        async with self._conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)) as cursor:
            row = await cursor.fetchone()
        if row is None:
            raise KeyError(f"Run not found: {run_id}")
        return dict(row)

    async def update_run_status(self, run_id: str, status: str) -> None:
        """Update only the status field of a run."""
        await self._execute(
            "UPDATE runs SET status = ? WHERE id = ?",
            (status, run_id),
        )

    async def complete_run(
        self,
        run_id: str,
        *,
        queries: int,
        pages_fetched: int,
        entries_found: int,
        entries_after_dedup: int,
    ) -> None:
        """Mark a run as completed and record its final statistics."""
        await self._execute(
            """
            UPDATE runs
            SET status = 'completed',
                completed_at = ?,
                queries = ?,
                pages_fetched = ?,
                entries_found = ?,
                entries_after_dedup = ?
            WHERE id = ?
            """,
            (_now(), queries, pages_fetched, entries_found, entries_after_dedup, run_id),
        )

    async def fail_run(self, run_id: str, error: str) -> None:
        """Mark a run as failed and record the error message."""
        await self._execute(
            """
            UPDATE runs
            SET status = 'failed',
                completed_at = ?,
                error = ?
            WHERE id = ?
            """,
            (_now(), error, run_id),
        )

    async def cancel_run(self, run_id: str, error: str | None = None) -> None:
        """Mark a run as cancelled, optionally recording the cancellation reason."""
        await self._execute(
            """
            UPDATE runs
            SET status = 'cancelled',
                completed_at = ?,
                error = ?
            WHERE id = ?
            """,
            (_now(), error, run_id),
        )

    async def list_runs(self, limit: int = 50) -> list[dict[str, Any]]:
        """Return the most recent runs, newest first."""
        assert self._conn is not None
        async with self._conn.execute(
            "SELECT * FROM runs ORDER BY created_at DESC LIMIT ?", (limit,)
        ) as cursor:
            rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def list_syncable_run_ids(
        self,
        *,
        limit: int | None = None,
        include_synced: bool = False,
    ) -> list[str]:
        """Return completed run IDs with stored artifacts ready for sync."""
        assert self._conn is not None
        sync_filter = (
            ""
            if include_synced
            else """
              AND COALESCE(ra.sync_status, 'ready') NOT IN (
                  'synced',
                  'already_synced',
                  'syncing'
              )
            """
        )
        limit_clause = "" if limit is None else "LIMIT ?"
        params: tuple[Any, ...] = () if limit is None else (limit,)
        async with self._conn.execute(
            f"""
            SELECT r.id
            FROM runs r
            JOIN run_artifacts ra ON ra.run_id = r.id
            WHERE r.status = 'completed'
            {sync_filter}
            ORDER BY r.created_at DESC
            {limit_clause}
            """,
            params,
        ) as cursor:
            rows = await cursor.fetchall()
        return [str(row["id"]) for row in rows]

    async def save_run_artifacts(self, run_id: str, artifacts: DiscoveryRunArtifacts) -> str:
        """Persist a canonical artifact bundle for a run and return its stable hash."""
        sync_info = artifacts.manifest.sync or DiscoverySyncInfo(local_run_id=run_id)
        artifact_hash = sync_info.artifact_hash or compute_artifact_hash(artifacts)
        updated_sync = sync_info.model_copy(
            update={
                "local_run_id": sync_info.local_run_id or run_id,
                "artifact_hash": artifact_hash,
            }
        )
        updated_artifacts = artifacts.model_copy(
            update={
                "manifest": artifacts.manifest.model_copy(
                    update={
                        "sync": updated_sync,
                    }
                )
            }
        )
        await self._execute(
            """
            INSERT INTO run_artifacts (
                run_id,
                artifact_hash,
                artifacts_json,
                sync_status,
                remote_run_id,
                synced_at,
                last_error,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(run_id) DO UPDATE SET
                artifact_hash = excluded.artifact_hash,
                artifacts_json = excluded.artifacts_json,
                sync_status = excluded.sync_status,
                remote_run_id = excluded.remote_run_id,
                synced_at = excluded.synced_at,
                last_error = excluded.last_error,
                updated_at = excluded.updated_at
            """,
            (
                run_id,
                artifact_hash,
                updated_artifacts.model_dump_json(),
                updated_sync.sync_status,
                updated_sync.remote_run_id,
                updated_sync.synced_at.isoformat() if updated_sync.synced_at else None,
                updated_sync.last_error,
                _now(),
            ),
        )
        return artifact_hash

    async def get_run_artifacts(self, run_id: str) -> DiscoveryRunArtifacts | None:
        """Return the stored artifact bundle for a run, if present."""
        assert self._conn is not None
        async with self._conn.execute(
            "SELECT artifacts_json FROM run_artifacts WHERE run_id = ?",
            (run_id,),
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            return None
        return DiscoveryRunArtifacts.model_validate_json(str(row["artifacts_json"]))

    async def update_run_sync(
        self,
        run_id: str,
        *,
        sync_status: str,
        remote_run_id: str | None = None,
        last_error: str | None = None,
        synced_at: datetime | None = None,
    ) -> DiscoveryRunArtifacts:
        """Update sync metadata inside the stored artifact bundle and return the updated bundle."""
        artifacts = await self.get_run_artifacts(run_id)
        if artifacts is None:
            raise KeyError(f"Run artifacts not found: {run_id}")

        sync_info = artifacts.manifest.sync or DiscoverySyncInfo(local_run_id=run_id)
        updated_sync = sync_info.model_copy(
            update={
                "local_run_id": sync_info.local_run_id or run_id,
                "sync_status": sync_status,
                "remote_run_id": remote_run_id or sync_info.remote_run_id,
                "synced_at": synced_at or sync_info.synced_at,
                "last_error": last_error,
            }
        )
        updated_artifacts = artifacts.model_copy(
            update={
                "manifest": artifacts.manifest.model_copy(
                    update={
                        "sync": updated_sync,
                    }
                )
            }
        )
        await self.save_run_artifacts(run_id, updated_artifacts)
        return updated_artifacts

    async def find_running_direct_run(self, urls: list[str]) -> str | None:
        """Return a matching active direct-URL run ID when one is already in progress."""
        if not urls:
            return None
        assert self._conn is not None
        placeholders = ", ".join("?" for _ in urls)
        params: tuple[Any, ...] = (*urls, len(set(urls)))
        async with self._conn.execute(
            f"""
            SELECT r.id
            FROM runs r
            JOIN page_tasks pt ON pt.run_id = r.id
            WHERE r.status = 'running'
              AND r.location = ''
              AND r.issues = '[]'
              AND pt.url IN ({placeholders})
            GROUP BY r.id
            HAVING COUNT(DISTINCT pt.url) = ?
            ORDER BY r.created_at DESC
            LIMIT 1
            """,
            params,
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            return None
        return str(row["id"])

    # ------------------------------------------------------------------
    # Page cache
    # ------------------------------------------------------------------

    async def get_cached_page(self, url: str, ttl_days: int | None = 7) -> dict[str, Any] | None:
        """Return a cached page if it exists and is within TTL, else None."""
        assert self._conn is not None
        sql = "SELECT * FROM pages WHERE url = ?"
        params: tuple[Any, ...] = (url,)
        if ttl_days is not None:
            sql += f" AND fetched_at > datetime('now', '-{ttl_days} days')"
        async with self._conn.execute(sql, params) as cursor:
            row = await cursor.fetchone()
        if row is None:
            return None
        result = dict(row)
        result["metadata"] = json.loads(result["metadata"])
        return result

    async def cache_page(self, url: str, text: str, metadata: dict[str, Any]) -> None:
        """Insert or replace a page in the cache."""
        content_hash = sha256(text.encode("utf-8")).hexdigest()
        await self._execute(
            """
            INSERT OR REPLACE INTO pages (url, text, metadata, content_hash, fetched_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (url, text, json.dumps(metadata), content_hash, _now()),
        )

    async def list_pages(self, limit: int = 100) -> list[dict[str, Any]]:
        """Return cached pages ordered by most recent fetch time."""
        assert self._conn is not None
        async with self._conn.execute(
            "SELECT * FROM pages ORDER BY fetched_at DESC LIMIT ?",
            (limit,),
        ) as cursor:
            rows = await cursor.fetchall()
        results: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["metadata"] = json.loads(item["metadata"])
            results.append(item)
        return results

    # ------------------------------------------------------------------
    # Articles
    # ------------------------------------------------------------------
