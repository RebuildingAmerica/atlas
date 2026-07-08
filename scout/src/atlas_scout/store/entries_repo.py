"""Discovered entries: CRUD, source-key dedup lookups, and launch-quality stats."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from atlas_scout.store._util import new_id, now
from atlas_scout.store.entries_support import EntryStatsMixin

if TYPE_CHECKING:
    from atlas_scout.store.db import Database

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


class EntryRepository(EntryStatsMixin):
    """Persists discovered entries and computes launch-quality aggregate stats."""

    def __init__(self, db: Database) -> None:
        self._db = db

    async def ensure_schema(self) -> None:
        """Create the entries table if it doesn't exist."""
        await self._db.connection.execute(_CREATE_ENTRIES)

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
        entry_id = new_id()
        await self._db.execute(
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
                now(),
            ),
        )
        return entry_id

    async def bulk_save_entries(
        self,
        *,
        run_id: str,
        entries: list[dict[str, Any]],
        batch_size: int = 5000,
    ) -> list[str]:
        """Insert many entries efficiently and return their IDs.

        Parameters
        ----------
        run_id : str
            Owning Scout run ID.
        entries : list[dict[str, Any]]
            Entry payloads with the same fields accepted by `save_entry`.
        batch_size : int, optional
            Number of rows to commit per batch. Default is 5000.

        Returns
        -------
        list[str]
            IDs assigned to the inserted entries.
        """
        if batch_size <= 0:
            raise ValueError("batch_size must be positive")

        conn = self._db.connection
        entry_ids: list[str] = []
        created_at = now()
        rows: list[tuple[Any, ...]] = []
        for entry in entries:
            entry_id = new_id()
            entry_ids.append(entry_id)
            rows.append(
                (
                    entry_id,
                    run_id,
                    entry["name"],
                    entry["entry_type"],
                    entry.get("description", ""),
                    entry.get("city"),
                    entry.get("state"),
                    entry.get("score", 0.0),
                    json.dumps(entry.get("data", {})),
                    created_at,
                )
            )

        for start in range(0, len(rows), batch_size):
            await conn.executemany(
                """
                INSERT INTO entries
                    (id, run_id, name, entry_type, description, city, state, score, data, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows[start : start + batch_size],
            )
            await conn.commit()

        return entry_ids

    async def existing_source_keys(self, entry_type: str | None = None) -> set[str]:
        """Return source identity keys already present in local entries.

        Parameters
        ----------
        entry_type : str | None, optional
            Restrict the lookup to one entry type.

        Returns
        -------
        set[str]
            Existing structured-source keys.
        """
        if entry_type is None:
            sql = "SELECT data FROM entries"
            params: tuple[Any, ...] = ()
        else:
            sql = "SELECT data FROM entries WHERE entry_type = ?"
            params = (entry_type,)

        keys: set[str] = set()
        async with self._db.connection.execute(sql, params) as cursor:
            rows = await cursor.fetchall()
        for row in rows:
            data = json.loads(row["data"])
            source_key = data.get("source_key")
            if isinstance(source_key, str) and source_key:
                keys.add(source_key)
        return keys

    async def count_entries_by_source_dataset(self, source_dataset: str) -> int:
        """Return the number of active entries tagged with one source dataset.

        Parameters
        ----------
        source_dataset : str
            Dataset marker stored in each entry's JSON payload.

        Returns
        -------
        int
            Number of matching active entries.
        """
        resolved_source_dataset = source_dataset.strip()
        if not resolved_source_dataset:
            raise ValueError("source_dataset must not be blank")

        async with self._db.connection.execute("SELECT data FROM entries") as cursor:
            rows = list(await cursor.fetchall())

        matches = 0
        for row in rows:
            data = json.loads(row["data"])
            if data.get("source_dataset") == resolved_source_dataset:
                matches += 1
        return matches

    async def purge_entries_by_source_dataset(self, source_dataset: str) -> int:
        """Delete active entries tagged with one source dataset.

        Parameters
        ----------
        source_dataset : str
            Dataset marker stored in each entry's JSON payload.

        Returns
        -------
        int
            Number of entries deleted.
        """
        resolved_source_dataset = source_dataset.strip()
        if not resolved_source_dataset:
            raise ValueError("source_dataset must not be blank")

        conn = self._db.connection
        async with conn.execute("SELECT id, data FROM entries") as cursor:
            rows = list(await cursor.fetchall())

        delete_rows = [
            (row["id"],)
            for row in rows
            if json.loads(row["data"]).get("source_dataset") == resolved_source_dataset
        ]
        if not delete_rows:
            return 0

        await conn.execute("BEGIN IMMEDIATE")
        try:
            await conn.executemany("DELETE FROM entries WHERE id = ?", delete_rows)
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise

        return len(delete_rows)

    async def list_entries(
        self,
        run_id: str | None = None,
        min_score: float = 0.0,
    ) -> list[dict[str, Any]]:
        """Return entries, optionally filtered by run and minimum score."""
        if run_id is not None:
            sql = "SELECT * FROM entries WHERE run_id = ? AND score >= ? ORDER BY score DESC"
            params: tuple[Any, ...] = (run_id, min_score)
        else:
            sql = "SELECT * FROM entries WHERE score >= ? ORDER BY score DESC"
            params = (min_score,)

        async with self._db.connection.execute(sql, params) as cursor:
            rows = await cursor.fetchall()

        results = []
        for row in rows:
            entry = dict(row)
            entry["data"] = json.loads(entry["data"])
            results.append(entry)
        return results
