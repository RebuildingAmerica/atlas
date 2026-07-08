"""Shared helpers and stats for the entry repository."""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlparse


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


class EntryStatsMixin:
    """Launch-quality stats for discovered entries."""

    async def entry_stats(
        self,
        *,
        run_id: str | None = None,
        excluded_source_datasets: set[str] | None = None,
    ) -> dict[str, Any]:
        """Return aggregate entry counts for launch-data quality checks."""
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
