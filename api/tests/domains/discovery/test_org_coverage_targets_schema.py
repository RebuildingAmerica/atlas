"""Schema coverage for coverage targets."""
# ruff: noqa

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_init_db_creates_coverage_target_tables(test_db: object) -> None:
    """Fresh databases should include coverage target and linkage tables."""
    target_cursor = await test_db.execute("PRAGMA table_info(org_coverage_targets)")
    target_columns = {row[1] for row in await target_cursor.fetchall()}

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

    run_cursor = await test_db.execute("PRAGMA table_info(org_coverage_target_runs)")
    run_columns = {row[1] for row in await run_cursor.fetchall()}
    assert {"target_id", "run_id", "created_at"}.issubset(run_columns)

    entry_cursor = await test_db.execute("PRAGMA table_info(org_coverage_target_entries)")
    entry_columns = {row[1] for row in await entry_cursor.fetchall()}
    assert {"target_id", "entry_id", "created_at"}.issubset(entry_columns)
