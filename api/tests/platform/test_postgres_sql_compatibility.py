"""Postgres compatibility guards for shared catalog write paths."""

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
