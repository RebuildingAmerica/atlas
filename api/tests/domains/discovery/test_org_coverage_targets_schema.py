"""Schema coverage for coverage targets."""

# ruff: noqa

from __future__ import annotations

from tests.support.schema_introspection import table_columns

import pytest


@pytest.mark.asyncio
async def test_init_db_creates_coverage_target_tables(test_db: object) -> None:
    """Fresh databases should include coverage target and linkage tables."""
    target_columns = await table_columns(test_db, "org_coverage_targets")

    assert {
        "id",
        "org_id",
        "name",
        "geography",
        "issue_areas_json",
        "actor_types_json",
        "source_types_json",
        "status",
        "status_reason",
        "review_state",
        "gaps_json",
        "next_actions_json",
        "last_run_at",
        "last_reviewed_at",
        "created_by",
        "created_at",
        "updated_at",
    }.issubset(target_columns)

    run_columns = await table_columns(test_db, "org_coverage_target_runs")
    assert {"target_id", "run_id", "created_at"}.issubset(run_columns)

    entry_columns = await table_columns(test_db, "org_coverage_target_entries")
    assert {"target_id", "entry_id", "created_at"}.issubset(entry_columns)
