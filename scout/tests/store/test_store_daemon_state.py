"""Daemon state coverage for atlas_scout.store.ScoutStore."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import aiosqlite
import pytest

from atlas_scout.store import ScoutStore

from .store_support import _naive_datetime

if TYPE_CHECKING:
    from pathlib import Path


async def test_initialize_creates_tables(store: ScoutStore) -> None:
    tables = await store.list_tables()
    assert "daemon_state" in tables
    assert "runs" in tables
    assert "pages" in tables
    assert "entries" in tables
    assert "articles" in tables
    assert "article_extractions" in tables


async def test_get_daemon_state_defaults_to_stopped(store: ScoutStore) -> None:
    daemon_state = await store.get_daemon_state()

    assert daemon_state["status"] == "stopped"
    assert daemon_state["started_at"] is None
    assert daemon_state["last_heartbeat_at"] is None
    assert daemon_state["config_path"] is None
    assert daemon_state["profile_name"] is None
    assert daemon_state["process_id"] is None
    assert daemon_state["target_count"] == 0
    assert daemon_state["interval_seconds"] is None
    assert daemon_state["interval_basis"] is None
    assert daemon_state["last_tick_summary"] is None


async def test_start_daemon_persists_runtime_metadata(store: ScoutStore) -> None:
    started_at = datetime(2025, 1, 2, 3, 4, 5, tzinfo=UTC)

    await store.start_daemon(
        config_path="/Users/example/.config/atlas-scout/configs/laptop.toml",
        profile_name="laptop",
        target_count=3,
        process_id=4321,
        interval_seconds=86400,
        interval_basis="cron 0 2 * * *",
        started_at=started_at,
    )

    daemon_state = await store.get_daemon_state()

    assert daemon_state["status"] == "running"
    assert daemon_state["started_at"] == started_at.isoformat()
    assert daemon_state["last_heartbeat_at"] == started_at.isoformat()
    assert daemon_state["config_path"] == "/Users/example/.config/atlas-scout/configs/laptop.toml"
    assert daemon_state["profile_name"] == "laptop"
    assert daemon_state["target_count"] == 3
    assert daemon_state["process_id"] == 4321
    assert daemon_state["interval_seconds"] == 86400
    assert daemon_state["interval_basis"] == "cron 0 2 * * *"


async def test_claim_daemon_start_marks_state_as_starting(store: ScoutStore) -> None:
    claimed = await store.claim_daemon_start(
        config_path="/Users/example/.config/atlas-scout/configs/laptop.toml",
        profile_name="laptop",
        target_count=3,
        interval_seconds=86400,
        interval_basis="cron 0 2 * * *",
    )

    daemon_state = await store.get_daemon_state()

    assert claimed is True
    assert daemon_state["status"] == "starting"
    assert daemon_state["config_path"] == "/Users/example/.config/atlas-scout/configs/laptop.toml"
    assert daemon_state["profile_name"] == "laptop"
    assert daemon_state["target_count"] == 3
    assert daemon_state["interval_seconds"] == 86400
    assert daemon_state["interval_basis"] == "cron 0 2 * * *"
    assert daemon_state["process_id"] is None


async def test_claim_daemon_start_allows_only_one_winner(tmp_path: Path) -> None:
    db_path = tmp_path / "scout.db"
    first_store = ScoutStore(str(db_path))
    second_store = ScoutStore(str(db_path))
    await first_store.initialize()
    await second_store.initialize()

    try:
        first_result, second_result = await asyncio.gather(
            first_store.claim_daemon_start(
                config_path="/Users/example/.config/atlas-scout/configs/laptop.toml",
                profile_name="laptop",
                target_count=3,
                interval_seconds=86400,
                interval_basis="cron 0 2 * * *",
            ),
            second_store.claim_daemon_start(
                config_path="/Users/example/.config/atlas-scout/configs/laptop.toml",
                profile_name="laptop",
                target_count=3,
                interval_seconds=86400,
                interval_basis="cron 0 2 * * *",
            ),
        )
    finally:
        await first_store.close()
        await second_store.close()

    assert sorted([first_result, second_result]) == [False, True]


async def test_claim_daemon_start_allows_only_one_stale_reclaim_winner(tmp_path: Path) -> None:
    db_path = tmp_path / "scout.db"
    seed_store = ScoutStore(str(db_path))
    await seed_store.initialize()
    await seed_store.claim_daemon_start(
        config_path="/Users/example/.config/atlas-scout/configs/laptop.toml",
        profile_name="laptop",
        target_count=3,
        interval_seconds=86400,
        interval_basis="cron 0 2 * * *",
    )
    daemon_state = await seed_store.get_daemon_state()
    await seed_store.close()

    first_store = ScoutStore(str(db_path))
    second_store = ScoutStore(str(db_path))
    await first_store.initialize()
    await second_store.initialize()

    try:
        first_result, second_result = await asyncio.gather(
            first_store.claim_daemon_start(
                config_path="/Users/example/.config/atlas-scout/configs/laptop.toml",
                profile_name="laptop",
                target_count=3,
                interval_seconds=86400,
                interval_basis="cron 0 2 * * *",
                expected_status="starting",
                expected_process_id=None,
                expected_updated_at=str(daemon_state["updated_at"]),
            ),
            second_store.claim_daemon_start(
                config_path="/Users/example/.config/atlas-scout/configs/laptop.toml",
                profile_name="laptop",
                target_count=3,
                interval_seconds=86400,
                interval_basis="cron 0 2 * * *",
                expected_status="starting",
                expected_process_id=None,
                expected_updated_at=str(daemon_state["updated_at"]),
            ),
        )
    finally:
        await first_store.close()
        await second_store.close()

    assert sorted([first_result, second_result]) == [False, True]


async def test_start_daemon_rejects_negative_target_count(store: ScoutStore) -> None:
    with pytest.raises(ValueError, match="target_count must be non-negative"):
        await store.start_daemon(
            config_path="/Users/example/.config/atlas-scout/configs/laptop.toml",
            profile_name="laptop",
            target_count=-1,
        )


async def test_daemon_state_table_rejects_negative_target_count(store: ScoutStore) -> None:
    with pytest.raises(aiosqlite.IntegrityError, match="CHECK constraint failed"):
        await store._db.execute(
            "UPDATE daemon_state SET target_count = -1 WHERE key = ?",
            ("scout",),
        )


@pytest.mark.parametrize(
    ("method_name", "kwargs"),
    [
        (
            "start_daemon",
            {
                "config_path": "/Users/example/.config/atlas-scout/configs/laptop.toml",
                "profile_name": "laptop",
                "target_count": 3,
                "started_at": _naive_datetime(),
            },
        ),
        (
            "record_daemon_heartbeat",
            {
                "heartbeat_at": _naive_datetime(),
            },
        ),
        (
            "stop_daemon",
            {
                "stopped_at": _naive_datetime(),
            },
        ),
        (
            "record_daemon_tick_result",
            {
                "status": "completed",
                "run_count": 1,
                "summary": "completed",
                "started_at": _naive_datetime(),
            },
        ),
    ],
)
async def test_daemon_state_methods_reject_naive_datetimes(
    store: ScoutStore, method_name: str, kwargs: dict[str, object]
) -> None:
    method = getattr(store, method_name)

    with pytest.raises(ValueError, match="timezone-aware"):
        await method(**kwargs)


async def test_stop_daemon_preserves_last_recorded_heartbeat(store: ScoutStore) -> None:
    started_at = datetime(2025, 1, 2, 3, 4, 5, tzinfo=UTC)
    heartbeat_at = datetime(2025, 1, 2, 3, 9, 5, tzinfo=UTC)
    stopped_at = datetime(2025, 1, 2, 3, 10, 5, tzinfo=UTC)

    await store.start_daemon(
        config_path="/Users/example/.config/atlas-scout/configs/laptop.toml",
        profile_name="laptop",
        target_count=3,
        process_id=4321,
        interval_seconds=86400,
        interval_basis="cron 0 2 * * *",
        started_at=started_at,
    )
    await store.record_daemon_heartbeat(heartbeat_at=heartbeat_at)
    await store.stop_daemon(stopped_at=stopped_at)

    daemon_state = await store.get_daemon_state()

    assert daemon_state["status"] == "stopped"
    assert daemon_state["started_at"] == started_at.isoformat()
    assert daemon_state["last_heartbeat_at"] == heartbeat_at.isoformat()
    assert daemon_state["process_id"] is None


async def test_stop_daemon_preserves_start_time_when_no_new_heartbeat_recorded(
    store: ScoutStore,
) -> None:
    started_at = datetime(2025, 1, 2, 3, 4, 5, tzinfo=UTC)
    stopped_at = datetime(2025, 1, 2, 3, 10, 5, tzinfo=UTC)

    await store.start_daemon(
        config_path="/Users/example/.config/atlas-scout/configs/laptop.toml",
        profile_name="laptop",
        target_count=3,
        process_id=4321,
        interval_seconds=86400,
        interval_basis="cron 0 2 * * *",
        started_at=started_at,
    )
    await store.stop_daemon(stopped_at=stopped_at)

    daemon_state = await store.get_daemon_state()

    assert daemon_state["status"] == "stopped"
    assert daemon_state["started_at"] == started_at.isoformat()
    assert daemon_state["last_heartbeat_at"] == started_at.isoformat()
    assert daemon_state["process_id"] is None


async def test_record_daemon_tick_result(store: ScoutStore) -> None:
    tick_started_at = datetime(2025, 1, 2, 3, 4, 5, tzinfo=UTC)
    tick_completed_at = datetime(2025, 1, 2, 3, 6, 5, tzinfo=UTC)

    await store.record_daemon_tick_result(
        status="completed",
        run_count=2,
        summary="2 scheduled runs completed",
        started_at=tick_started_at,
        completed_at=tick_completed_at,
    )

    daemon_state = await store.get_daemon_state()

    assert daemon_state["last_tick_summary"] == {
        "status": "completed",
        "run_count": 2,
        "summary": "2 scheduled runs completed",
        "started_at": tick_started_at.isoformat(),
        "completed_at": tick_completed_at.isoformat(),
        "error": None,
    }
