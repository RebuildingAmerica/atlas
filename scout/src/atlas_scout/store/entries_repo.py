"""Discovered entries: CRUD, source-key dedup lookups, and launch-quality stats."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from atlas_scout.store._util import new_id, now

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


def _has_source_context(data: dict[str, Any]) -> bool:
    """Return whether an entry has source-local context beyond a bare URL."""
    source_context = data.get("source_context")
    if isinstance(source_context, str) and source_context.strip():
        return True

    extraction_context = data.get("extraction_context")
    if isinstance(extraction_context, str) and extraction_context.strip():
        return True

    source_contexts = data.get("source_contexts")
    if isinstance(source_contexts, dict):
        return any(isinstance(value, str) and value.strip() for value in source_contexts.values())

    return False


def _entry_exact_key(
    *,
    name: str,
    city: str | None,
    state: str | None,
    entry_type: str,
) -> tuple[str, str, str, str]:
    """Return the conservative exact key used for entry uniqueness stats."""
    return (
        name.strip().lower(),
        city.strip().upper() if city else "",
        state.strip().upper() if state else "",
        entry_type.strip().lower(),
    )


class EntryRepository:
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

    async def entry_stats(
        self,
        *,
        run_id: str | None = None,
        excluded_source_datasets: set[str] | None = None,
    ) -> dict[str, Any]:
        """Return aggregate entry counts for launch-data quality checks.

        Parameters
        ----------
        run_id : str | None, optional
            Restrict stats to one run.
        excluded_source_datasets : set[str] | None, optional
            Source dataset names to omit from active quality gates.

        Returns
        -------
        dict[str, Any]
            Entry totals grouped by type, source provenance, run, location, and metro.
        """
        if run_id is None:
            sql = """
                SELECT e.run_id, e.name, e.entry_type, e.description, e.city, e.state, e.data,
                       r.location
                FROM entries e
                JOIN runs r ON r.id = e.run_id
            """
            params: tuple[Any, ...] = ()
        else:
            sql = """
                SELECT e.run_id, e.name, e.entry_type, e.description, e.city, e.state, e.data,
                       r.location
                FROM entries e
                JOIN runs r ON r.id = e.run_id
                WHERE e.run_id = ?
            """
            params = (run_id,)

        async with self._db.connection.execute(sql, params) as cursor:
            rows = list(await cursor.fetchall())

        excluded_datasets = excluded_source_datasets or set()
        by_type: dict[str, int] = {}
        by_source_dataset: dict[str, int] = {}
        by_location: dict[str, int] = {}
        by_metro: dict[str, int] = {}
        by_run: dict[str, int] = {}
        total_entries = 0
        source_backed_entries = 0
        contextual_person_count = 0
        source_key_counts: dict[str, int] = {}
        source_urls_seen: set[str] = set()
        source_domains_seen: set[str] = set()
        exact_key_counts: dict[tuple[str, str, str, str], int] = {}
        unique_person_keys: set[tuple[str, str, str, str]] = set()

        for row in rows:
            data = json.loads(row["data"])
            source_dataset = data.get("source_dataset")
            if (
                isinstance(source_dataset, str)
                and source_dataset
                and source_dataset in excluded_datasets
            ):
                continue

            total_entries += 1
            entry_type = str(row["entry_type"])
            by_type[entry_type] = by_type.get(entry_type, 0) + 1
            exact_key = _entry_exact_key(
                name=str(row["name"]),
                city=row["city"],
                state=row["state"],
                entry_type=entry_type,
            )
            exact_key_counts[exact_key] = exact_key_counts.get(exact_key, 0) + 1
            if entry_type == "person":
                unique_person_keys.add(exact_key)

            row_run_id = str(row["run_id"])
            by_run[row_run_id] = by_run.get(row_run_id, 0) + 1
            row_location = str(row["location"] or "")
            if row_location:
                by_location[row_location] = by_location.get(row_location, 0) + 1

            source_key = data.get("source_key")
            source_urls = data.get("source_urls")
            has_source_key = isinstance(source_key, str) and bool(source_key)
            has_source_urls = isinstance(source_urls, list) and bool(source_urls)
            if has_source_key or has_source_urls:
                source_backed_entries += 1
            if has_source_key:
                source_key_counts[source_key] = source_key_counts.get(source_key, 0) + 1

            if isinstance(source_dataset, str) and source_dataset:
                by_source_dataset[source_dataset] = by_source_dataset.get(source_dataset, 0) + 1

            if isinstance(source_urls, list):
                for source_url in source_urls:
                    if isinstance(source_url, str) and source_url:
                        source_urls_seen.add(source_url)
                        parsed_url = urlparse(source_url)
                        if parsed_url.netloc:
                            source_domains_seen.add(parsed_url.netloc.lower())

            description = row["description"]
            if (
                entry_type == "person"
                and isinstance(description, str)
                and description.strip()
                and _has_source_context(data)
            ):
                contextual_person_count += 1

            metro = data.get("metro")
            if isinstance(metro, str) and metro:
                by_metro[metro] = by_metro.get(metro, 0) + 1

        duplicate_source_keys = {
            source_key: count for source_key, count in source_key_counts.items() if count > 1
        }
        exact_duplicate_counts = [count for count in exact_key_counts.values() if count > 1]
        return {
            "total_entries": total_entries,
            "by_type": by_type,
            "source_backed_entries": source_backed_entries,
            "by_source_dataset": by_source_dataset,
            "by_location": by_location,
            "by_metro": by_metro,
            "by_run": by_run,
            "contextual_person_count": contextual_person_count,
            "source_url_count": len(source_urls_seen),
            "source_domain_count": len(source_domains_seen),
            "duplicate_source_keys": duplicate_source_keys,
            "exact_duplicate_groups": len(exact_duplicate_counts),
            "exact_duplicate_surplus": sum(count - 1 for count in exact_duplicate_counts),
            "unique_person_keys": len(unique_person_keys),
        }

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
