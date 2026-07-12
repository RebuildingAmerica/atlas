"""Postgres compatibility guards for shared catalog read/write paths."""

from __future__ import annotations

from pathlib import Path


def test_catalog_sync_write_paths_avoid_sqlite_only_conflict_syntax() -> None:
    """Scout sync write paths must run against the production Postgres database."""
    api_root = Path(__file__).resolve().parents[2]
    guarded_paths = [
        api_root / "atlas/domains/discovery/pipeline/runner_storage_persistence.py",
        api_root / "atlas/domains/catalog/models/source.py",
        api_root / "atlas/domains/catalog/models/entry_lookup.py",
    ]
    sqlite_only_fragments = ("INSERT OR IGNORE", "INSERT OR REPLACE", "REPLACE INTO")

    violations = [
        f"{path.relative_to(api_root)} uses {fragment}"
        for path in guarded_paths
        for fragment in sqlite_only_fragments
        if fragment in path.read_text()
    ]

    assert violations == []


def test_public_catalog_sql_does_not_slice_timestamp_columns() -> None:
    """Public read paths must not call SQLite-style substr() on Postgres timestamps."""
    api_root = Path(__file__).resolve().parents[2]
    guarded_paths = [
        api_root / "atlas/domains/catalog/models/entry_search_backend.py",
        api_root / "atlas/domains/catalog/models/entry_search_query.py",
        api_root / "atlas/domains/moderation/review_queue.py",
        api_root / "atlas/domains/discovery/api_org_quality.py",
        api_root / "atlas/platform/mcp/data_service_search.py",
        api_root / "atlas/platform/mcp/data_parts/service_sources.py",
    ]
    timestamp_slices = (
        "substr(s.ingested_at",
        "substr(s.created_at",
        "substr(cast(s.ingested_at",
        "substr(cast(s.created_at",
    )

    violations = [
        f"{path.relative_to(api_root)} slices timestamp column with {fragment}"
        for path in guarded_paths
        for fragment in timestamp_slices
        if fragment in path.read_text().lower()
    ]

    assert violations == []
