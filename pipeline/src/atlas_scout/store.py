"""Local SQLite store for Atlas Scout runs, cache, entries, and daemon state."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any

import aiosqlite
from atlas_shared import DiscoveryRunArtifacts, DiscoverySyncInfo, compute_artifact_hash

_CREATE_RUNS = """
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    location TEXT NOT NULL,
    issues TEXT NOT NULL,
    search_depth TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT,
    completed_at TEXT,
    queries INTEGER,
    pages_fetched INTEGER,
    entries_found INTEGER,
    entries_after_dedup INTEGER,
    error TEXT,
    created_at TEXT NOT NULL
)
"""

_CREATE_PAGES = """
CREATE TABLE IF NOT EXISTS pages (
    url TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    content_hash TEXT,
    fetched_at TEXT NOT NULL
)
"""

_CREATE_PAGE_TASKS = """
CREATE TABLE IF NOT EXISTS page_tasks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    error TEXT,
    entries_extracted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""

_CREATE_ENTRIES = """
CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    name TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    description TEXT NOT NULL,
    city TEXT,
    state TEXT,
    score REAL NOT NULL DEFAULT 0.0,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
)
"""

_CREATE_EXTRACTIONS = """
CREATE TABLE IF NOT EXISTS extractions (
    cache_key TEXT PRIMARY KEY,
    source_fingerprint TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    prompt_key TEXT NOT NULL,
    entries TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
)
"""

_CREATE_RUN_ARTIFACTS = """
CREATE TABLE IF NOT EXISTS run_artifacts (
    run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    artifact_hash TEXT NOT NULL,
    artifacts_json TEXT NOT NULL,
    sync_status TEXT,
    remote_run_id TEXT,
    synced_at TEXT,
    last_error TEXT,
    updated_at TEXT NOT NULL
)
"""

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

_CREATE_DAEMON_STATE = """
CREATE TABLE IF NOT EXISTS daemon_state (
    key TEXT PRIMARY KEY CHECK(key = 'scout'),
    status TEXT NOT NULL DEFAULT 'stopped' CHECK(status IN ('running', 'stopped')),
    started_at TEXT,
    last_heartbeat_at TEXT,
    config_path TEXT,
    profile_name TEXT,
    target_count INTEGER NOT NULL DEFAULT 0,
    last_tick_summary TEXT,
    updated_at TEXT NOT NULL
)
"""

_CREATE_PAGE_TASKS_RUN_URL_INDEX = """
CREATE INDEX IF NOT EXISTS idx_page_tasks_run_url
ON page_tasks(run_id, url)
"""

_CREATE_PAGE_TASKS_RUN_STATUS_INDEX = """
CREATE INDEX IF NOT EXISTS idx_page_tasks_run_status
ON page_tasks(run_id, status)
"""

_DAEMON_STATE_KEY = "scout"


def _now() -> str:
    """Return the current UTC time as an ISO 8601 string."""
    return datetime.now(UTC).isoformat()


def _new_id() -> str:
    """Generate a short random hex ID (12 characters)."""
    return uuid.uuid4().hex[:12]


def _serialize_timestamp(value: datetime | None) -> str | None:
    """Normalize an optional timestamp to UTC ISO 8601."""
    if value is None:
        return None
    return value.astimezone(UTC).isoformat()


class ScoutStore:
    """Async SQLite store for Scout's local state."""

    def __init__(self, db_path: str) -> None:
        """Store the database path; call initialize() before use."""
        self._db_path = db_path
        self._conn: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        """Open the database connection and create tables if needed."""
        self._conn = await aiosqlite.connect(self._db_path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA synchronous=NORMAL")
        await self._conn.execute("PRAGMA busy_timeout=5000")
        await self._conn.execute(_CREATE_RUNS)
        await self._conn.execute(_CREATE_PAGES)
        await self._conn.execute(_CREATE_PAGE_TASKS)
        await self._conn.execute(_CREATE_ENTRIES)
        await self._conn.execute(_CREATE_EXTRACTIONS)
        await self._conn.execute(_CREATE_RUN_ARTIFACTS)
        await self._conn.execute(_CREATE_WORK_CLAIMS)
        await self._conn.execute(_CREATE_DAEMON_STATE)
        await self._conn.execute(_CREATE_PAGE_TASKS_RUN_URL_INDEX)
        await self._conn.execute(_CREATE_PAGE_TASKS_RUN_STATUS_INDEX)
        await self._conn.execute(
            """
            INSERT INTO daemon_state (key, status, target_count, updated_at)
            VALUES (?, 'stopped', 0, ?)
            ON CONFLICT(key) DO NOTHING
            """,
            (_DAEMON_STATE_KEY, _now()),
        )
        await self._conn.commit()

    async def close(self) -> None:
        """Close the database connection."""
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def list_tables(self) -> list[str]:
        """Return the names of all user tables in the database."""
        assert self._conn is not None
        async with self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ) as cursor:
            rows = await cursor.fetchall()
        return [row["name"] for row in rows]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _execute(self, sql: str, params: tuple[Any, ...] = ()) -> None:
        """Execute a single statement and commit."""
        assert self._conn is not None
        await self._conn.execute(sql, params)
        await self._conn.commit()

    # ------------------------------------------------------------------
    # Daemon state
    # ------------------------------------------------------------------

    async def get_daemon_state(self) -> dict[str, Any]:
        """Return the persisted daemon lifecycle state."""
        assert self._conn is not None
        async with self._conn.execute(
            "SELECT * FROM daemon_state WHERE key = ?",
            (_DAEMON_STATE_KEY,),
        ) as cursor:
            row = await cursor.fetchone()
        if row is None:
            raise KeyError("Daemon state not initialized")
        daemon_state = dict(row)
        raw_last_tick_summary = daemon_state["last_tick_summary"]
        if raw_last_tick_summary is not None:
            daemon_state["last_tick_summary"] = json.loads(raw_last_tick_summary)
        return daemon_state

    async def start_daemon(
        self,
        *,
        config_path: str,
        profile_name: str | None,
        target_count: int,
        started_at: datetime | None = None,
    ) -> None:
        """Mark the daemon as running and persist its active configuration metadata."""
        started_at_iso = _serialize_timestamp(started_at) or _now()
        await self._execute(
            """
            UPDATE daemon_state
            SET status = 'running',
                started_at = ?,
                last_heartbeat_at = ?,
                config_path = ?,
                profile_name = ?,
                target_count = ?,
                updated_at = ?
            WHERE key = ?
            """,
            (
                started_at_iso,
                started_at_iso,
                config_path,
                profile_name,
                target_count,
                started_at_iso,
                _DAEMON_STATE_KEY,
            ),
        )

    async def record_daemon_heartbeat(self, *, heartbeat_at: datetime | None = None) -> None:
        """Update the daemon heartbeat timestamp."""
        heartbeat_at_iso = _serialize_timestamp(heartbeat_at) or _now()
        await self._execute(
            """
            UPDATE daemon_state
            SET last_heartbeat_at = ?,
                updated_at = ?
            WHERE key = ?
            """,
            (heartbeat_at_iso, heartbeat_at_iso, _DAEMON_STATE_KEY),
        )

    async def stop_daemon(self, *, stopped_at: datetime | None = None) -> None:
        """Mark the daemon as stopped while preserving the last active configuration."""
        stopped_at_iso = _serialize_timestamp(stopped_at) or _now()
        await self._execute(
            """
            UPDATE daemon_state
            SET status = 'stopped',
                last_heartbeat_at = ?,
                updated_at = ?
            WHERE key = ?
            """,
            (stopped_at_iso, stopped_at_iso, _DAEMON_STATE_KEY),
        )

    async def record_daemon_tick_result(
        self,
        *,
        status: str,
        run_count: int,
        summary: str,
        started_at: datetime | None = None,
        completed_at: datetime | None = None,
        error: str | None = None,
    ) -> None:
        """Persist a structured summary for the most recent scheduler tick."""
        completed_at_iso = _serialize_timestamp(completed_at) or _now()
        tick_summary = json.dumps(
            {
                "status": status,
                "run_count": run_count,
                "summary": summary,
                "started_at": _serialize_timestamp(started_at),
                "completed_at": completed_at_iso,
                "error": error,
            }
        )
        await self._execute(
            """
            UPDATE daemon_state
            SET last_tick_summary = ?,
                updated_at = ?
            WHERE key = ?
            """,
            (tick_summary, completed_at_iso, _DAEMON_STATE_KEY),
        )

    # ------------------------------------------------------------------
    # Runs
    # ------------------------------------------------------------------

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
        async with self._conn.execute(
            "SELECT * FROM runs WHERE id = ?", (run_id,)
        ) as cursor:
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

    async def get_cached_page(
        self, url: str, ttl_days: int | None = 7
    ) -> dict[str, Any] | None:
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
    # Page tasks
    # ------------------------------------------------------------------

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
            if current_owner_status is not None and current_owner_status not in {"pending", "running"}:
                await self.fail_work(key, "reclaimed_from_inactive_run")

        lease_expires_at = (now + timedelta(seconds=lease_seconds)).isoformat()
        await self._conn.execute(
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
        await self._conn.commit()
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

    async def save_entry(
        self,
        *,
        run_id: str,
        name: str,
        entry_type: str,
        description: str,
        city: str | None,
        state: str | None,
        score: float,
        data: dict[str, Any],
    ) -> str:
        """Insert an entry and return its ID."""
        entry_id = _new_id()
        await self._execute(
            """
            INSERT INTO entries
                (id, run_id, name, entry_type, description, city, state, score, data, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entry_id,
                run_id,
                name,
                entry_type,
                description,
                city,
                state,
                score,
                json.dumps(data),
                _now(),
            ),
        )
        return entry_id

    async def list_entries(
        self,
        run_id: str | None = None,
        min_score: float = 0.0,
    ) -> list[dict[str, Any]]:
        """Return entries, optionally filtered by run and minimum score."""
        assert self._conn is not None
        if run_id is not None:
            sql = "SELECT * FROM entries WHERE run_id = ? AND score >= ? ORDER BY score DESC"
            params: tuple[Any, ...] = (run_id, min_score)
        else:
            sql = "SELECT * FROM entries WHERE score >= ? ORDER BY score DESC"
            params = (min_score,)

        async with self._conn.execute(sql, params) as cursor:
            rows = await cursor.fetchall()

        results = []
        for row in rows:
            entry = dict(row)
            entry["data"] = json.loads(entry["data"])
            results.append(entry)
        return results
