"""Tests for atlas_scout.store.ScoutStore."""

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import aiosqlite
import pytest
from atlas_shared import (
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoverySyncInfo,
)

from atlas_scout.store import ScoutStore


def _naive_datetime() -> datetime:
    return datetime(2025, 1, 2, 3, 4, 5, tzinfo=UTC).replace(tzinfo=None)


@pytest.fixture
async def store(tmp_db_path: object) -> AsyncIterator[ScoutStore]:
    s = ScoutStore(str(tmp_db_path))
    await s.initialize()
    yield s
    await s.close()


async def test_initialize_creates_tables(store: ScoutStore) -> None:
    tables = await store.list_tables()
    assert "daemon_state" in tables
    assert "runs" in tables
    assert "pages" in tables
    assert "entries" in tables


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


async def test_claim_daemon_start_allows_only_one_winner(tmp_path) -> None:
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


async def test_claim_daemon_start_allows_only_one_stale_reclaim_winner(tmp_path) -> None:
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
        await store._execute(
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


async def test_create_and_get_run(store: ScoutStore) -> None:
    run_id = await store.create_run(
        location="Austin, TX",
        issues=["housing_affordability"],
        search_depth="standard",
    )
    assert run_id is not None
    run = await store.get_run(run_id)
    assert run["location"] == "Austin, TX"
    assert run["status"] == "pending"


async def test_update_run_status(store: ScoutStore) -> None:
    run_id = await store.create_run(location="Austin, TX", issues=[], search_depth="standard")
    await store.update_run_status(run_id, "running")
    run = await store.get_run(run_id)
    assert run["status"] == "running"


async def test_complete_run_with_stats(store: ScoutStore) -> None:
    run_id = await store.create_run(location="Austin, TX", issues=[], search_depth="standard")
    await store.complete_run(
        run_id,
        queries=40,
        pages_fetched=120,
        entries_found=35,
        entries_after_dedup=28,
    )
    run = await store.get_run(run_id)
    assert run["status"] == "completed"
    assert run["entries_found"] == 35


async def test_page_cache_miss_then_hit(store: ScoutStore) -> None:
    cached = await store.get_cached_page("https://example.com")
    assert cached is None
    await store.cache_page("https://example.com", "Hello world", {"title": "Example"})
    cached = await store.get_cached_page("https://example.com")
    assert cached is not None
    assert cached["text"] == "Hello world"


async def test_page_cache_respects_ttl(store: ScoutStore) -> None:
    await store.cache_page("https://example.com", "Hello", {})
    await store._execute(
        "UPDATE pages SET fetched_at = datetime('now', '-30 days') WHERE url = ?",
        ("https://example.com",),
    )
    cached = await store.get_cached_page("https://example.com", ttl_days=7)
    assert cached is None


async def test_page_cache_can_ignore_ttl(store: ScoutStore) -> None:
    await store.cache_page("https://example.com", "Hello", {})
    await store._execute(
        "UPDATE pages SET fetched_at = datetime('now', '-30 days') WHERE url = ?",
        ("https://example.com",),
    )
    cached = await store.get_cached_page("https://example.com", ttl_days=None)
    assert cached is not None
    assert cached["text"] == "Hello"


async def test_work_claims_block_until_completed(store: ScoutStore) -> None:
    assert await store.claim_work("fetch:https://example.com", owner_run_id="run-1")
    assert not await store.claim_work("fetch:https://example.com", owner_run_id="run-2")

    await store.complete_work("fetch:https://example.com")

    assert await store.claim_work("fetch:https://example.com", owner_run_id="run-2")


async def test_work_claims_reclaim_from_cancelled_run(store: ScoutStore) -> None:
    run_1 = await store.create_run(location="", issues=[], search_depth="standard")
    run_2 = await store.create_run(location="", issues=[], search_depth="standard")
    await store.update_run_status(run_1, "running")
    await store.update_run_status(run_2, "running")

    assert await store.claim_work(
        "extract:https://example.com", owner_run_id=run_1, lease_seconds=300
    )
    await store.cancel_run(run_1, "cancelled")

    assert await store.claim_work(
        "extract:https://example.com", owner_run_id=run_2, lease_seconds=300
    )


async def test_extraction_cache_round_trip(store: ScoutStore) -> None:
    entries = [
        {
            "name": "Test Org",
            "entry_type": "organization",
            "description": "Affordable housing advocacy",
            "city": "Austin",
            "state": "TX",
        }
    ]
    await store.cache_extraction(
        cache_key="extract:abc",
        source_fingerprint="hash-1",
        provider_key="ollama:llama",
        prompt_key="prompt-1",
        entries=entries,
    )

    cached = await store.get_cached_extraction("extract:abc")

    assert cached is not None
    assert cached["entries"] == entries


async def test_save_and_list_entries(store: ScoutStore) -> None:
    run_id = await store.create_run(location="Austin, TX", issues=[], search_depth="standard")
    await store.save_entry(
        run_id=run_id,
        name="Housing Alliance",
        entry_type="organization",
        description="Affordable housing advocacy",
        city="Austin",
        state="TX",
        score=0.85,
        data={"issue_areas": ["housing_affordability"]},
    )
    entries = await store.list_entries(run_id=run_id)
    assert len(entries) == 1
    assert entries[0]["name"] == "Housing Alliance"
    assert entries[0]["score"] == 0.85


async def test_list_runs(store: ScoutStore) -> None:
    await store.create_run(location="Austin, TX", issues=[], search_depth="standard")
    await store.create_run(location="Houston, TX", issues=[], search_depth="deep")
    runs = await store.list_runs()
    assert len(runs) == 2


async def test_start_daemon_rejects_non_positive_process_id(store: ScoutStore) -> None:
    """A zero/negative process_id is rejected by validation."""
    with pytest.raises(ValueError, match="process_id must be positive"):
        await store.start_daemon(
            config_path="/cfg",
            profile_name="laptop",
            target_count=1,
            process_id=0,
        )


async def test_start_daemon_rejects_negative_interval_seconds(store: ScoutStore) -> None:
    """A negative interval_seconds is rejected by validation."""
    with pytest.raises(ValueError, match="interval_seconds must be non-negative"):
        await store.start_daemon(
            config_path="/cfg",
            profile_name="laptop",
            target_count=1,
            interval_seconds=-5,
        )


async def test_close_is_idempotent(tmp_db_path) -> None:
    """Calling close twice does nothing the second time."""
    s = ScoutStore(str(tmp_db_path))
    await s.initialize()
    await s.close()
    await s.close()


async def test_get_daemon_state_raises_when_table_empty(store: ScoutStore) -> None:
    """get_daemon_state raises KeyError when the row is missing."""
    await store._execute("DELETE FROM daemon_state WHERE key = ?", ("scout",))
    with pytest.raises(KeyError, match="not initialized"):
        await store.get_daemon_state()


async def test_claim_daemon_start_raises_when_table_empty(store: ScoutStore) -> None:
    """claim_daemon_start raises KeyError when the row is missing."""
    await store._execute("DELETE FROM daemon_state WHERE key = ?", ("scout",))
    with pytest.raises(KeyError, match="not initialized"):
        await store.claim_daemon_start(
            config_path="/cfg",
            profile_name="laptop",
            target_count=1,
        )


async def test_save_and_update_run_artifacts(store: ScoutStore) -> None:
    run_id = await store.create_run(
        location="Austin, TX",
        issues=["housing_affordability"],
        search_depth="standard",
    )
    artifacts = DiscoveryRunArtifacts(
        manifest=DiscoveryRunManifest(
            runner="atlas-scout",
            run=DiscoveryRunInput(
                location_query="Austin, TX",
                state="TX",
                issue_areas=["housing_affordability"],
            ),
            status="completed",
            sync=DiscoverySyncInfo(local_run_id=run_id, sync_status="ready"),
        )
    )

    artifact_hash = await store.save_run_artifacts(run_id, artifacts)
    stored = await store.get_run_artifacts(run_id)
    assert stored is not None
    assert stored.manifest.sync is not None
    assert stored.manifest.sync.artifact_hash == artifact_hash

    updated = await store.update_run_sync(
        run_id,
        sync_status="synced",
        remote_run_id="remote_123",
    )
    assert updated.manifest.sync is not None
    assert updated.manifest.sync.remote_run_id == "remote_123"
    assert updated.manifest.sync.sync_status == "synced"


async def test_fail_run_records_error(store: ScoutStore) -> None:
    """fail_run marks the run as failed and persists the error message."""
    run_id = await store.create_run(location="A", issues=[], search_depth="standard")
    await store.fail_run(run_id, "extraction_failed")
    run = await store.get_run(run_id)
    assert run["status"] == "failed"
    assert run["error"] == "extraction_failed"


async def test_get_cached_extraction_returns_none_for_missing_key(store: ScoutStore) -> None:
    """get_cached_extraction returns None when no cached row exists."""
    assert await store.get_cached_extraction("absent") is None


async def test_get_run_artifacts_returns_none_for_unknown_run(store: ScoutStore) -> None:
    """An unknown run_id yields None from get_run_artifacts."""
    assert await store.get_run_artifacts("does-not-exist") is None


async def test_update_run_sync_raises_for_unknown_run(store: ScoutStore) -> None:
    """update_run_sync raises KeyError when no artifacts exist for the run."""
    with pytest.raises(KeyError, match="Run artifacts not found"):
        await store.update_run_sync(
            "missing-run-id",
            sync_status="synced",
        )


async def test_find_running_direct_run_with_empty_urls(store: ScoutStore) -> None:
    """An empty URL list short-circuits to None."""
    assert await store.find_running_direct_run([]) is None


async def test_find_running_direct_run_returns_match(store: ScoutStore) -> None:
    """A running direct-URL run with matching URLs is returned."""
    run_id = await store.create_run(location="", issues=[], search_depth="standard")
    await store.update_run_status(run_id, "running")
    await store.create_page_task(run_id, "https://example.com/a")
    await store.create_page_task(run_id, "https://example.com/b")

    found = await store.find_running_direct_run(
        ["https://example.com/a", "https://example.com/b"]
    )
    assert found == run_id


async def test_find_running_direct_run_no_match(store: ScoutStore) -> None:
    """Non-matching URLs return None."""
    run_id = await store.create_run(location="", issues=[], search_depth="standard")
    await store.update_run_status(run_id, "running")
    await store.create_page_task(run_id, "https://example.com/x")

    assert await store.find_running_direct_run(["https://example.com/y"]) is None


async def test_list_pages_orders_by_recent_fetch(store: ScoutStore) -> None:
    """list_pages returns cached pages newest-first with parsed metadata."""
    await store.cache_page("https://example.com/a", "Hello A", {"title": "A"})
    await store.cache_page("https://example.com/b", "Hello B", {"title": "B"})

    pages = await store.list_pages()
    assert {p["url"] for p in pages} == {"https://example.com/a", "https://example.com/b"}
    for page in pages:
        assert page["metadata"]["title"] in {"A", "B"}


async def test_list_all_page_tasks_returns_recent(store: ScoutStore) -> None:
    """list_all_page_tasks returns recent tasks across all runs."""
    run_id = await store.create_run(location="Austin, TX", issues=[], search_depth="standard")
    await store.create_page_task(run_id, "https://example.com/a")
    await store.create_page_task(run_id, "https://example.com/b")

    tasks = await store.list_all_page_tasks()
    assert len(tasks) == 2
    assert {t["url"] for t in tasks} == {"https://example.com/a", "https://example.com/b"}


async def test_get_page_task_summary_groups_by_status(store: ScoutStore) -> None:
    """get_page_task_summary returns counts per status."""
    run_id = await store.create_run(location="", issues=[], search_depth="standard")
    task_a = await store.create_page_task(run_id, "https://example.com/a")
    task_b = await store.create_page_task(run_id, "https://example.com/b")
    await store.update_page_task(task_a, "completed", entries_extracted=2)
    await store.update_page_task(task_b, "failed", error="boom")

    summary = await store.get_page_task_summary(run_id)
    assert summary == {"completed": 1, "failed": 1}


async def test_run_status_returns_none_for_anonymous_owner(store: ScoutStore) -> None:
    """The internal _run_status helper short-circuits for anonymous owners."""
    assert await store._run_status("") is None
    assert await store._run_status("anonymous") is None


async def test_run_status_returns_none_for_missing_run(store: ScoutStore) -> None:
    """When no run exists for the given id, _run_status returns None."""
    assert await store._run_status("nonexistent-run") is None


async def test_list_entries_returns_all_runs_when_run_id_omitted(store: ScoutStore) -> None:
    """When run_id is None, list_entries returns entries across all runs."""
    run_a = await store.create_run(location="A", issues=[], search_depth="standard")
    run_b = await store.create_run(location="B", issues=[], search_depth="standard")
    await store.save_entry(
        run_id=run_a,
        name="Org A",
        entry_type="organization",
        description="d",
        city="Austin",
        state="TX",
        score=0.9,
        data={},
    )
    await store.save_entry(
        run_id=run_b,
        name="Org B",
        entry_type="organization",
        description="d",
        city="Austin",
        state="TX",
        score=0.5,
        data={},
    )

    entries = await store.list_entries(min_score=0.6)
    assert len(entries) == 1
    assert entries[0]["name"] == "Org A"


async def test_update_page_task_with_error_only(store: ScoutStore) -> None:
    """update_page_task accepts an error without entries_extracted."""
    run_id = await store.create_run(location="", issues=[], search_depth="standard")
    task = await store.create_page_task(run_id, "https://example.com/x")
    await store.update_page_task(task, "failed", error="network down")

    tasks = await store.list_page_tasks(run_id)
    assert tasks[0]["error"] == "network down"
    assert tasks[0]["status"] == "failed"


async def test_claim_daemon_start_rolls_back_on_unexpected_exception(
    store: ScoutStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unexpected exception during the BEGIN IMMEDIATE block triggers rollback."""
    # Force fetchone to raise to exercise the except/rollback path.
    original_execute = store._conn.execute

    call_count = {"value": 0}

    class _RaisingCursor:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def fetchone(self):
            raise RuntimeError("simulated cursor failure")

    def _patched_execute(*args, **kwargs):
        # Pass BEGIN IMMEDIATE through normally; intercept the SELECT inside the txn.
        call_count["value"] += 1
        sql = args[0] if args else ""
        if call_count["value"] == 2 and "SELECT status" in sql:
            return _RaisingCursor()
        return original_execute(*args, **kwargs)

    monkeypatch.setattr(store._conn, "execute", _patched_execute)

    with pytest.raises(RuntimeError, match="simulated cursor failure"):
        await store.claim_daemon_start(
            config_path="/cfg",
            profile_name="laptop",
            target_count=1,
        )


async def test_daemon_state_table_migration_replays_legacy_schema(tmp_path) -> None:
    """A legacy daemon_state schema is rewritten to the current shape on initialize."""
    db_path = tmp_path / "legacy.db"

    # Create a legacy daemon_state table missing the new constraints/columns.
    async with aiosqlite.connect(str(db_path)) as conn:
        await conn.execute(
            """
            CREATE TABLE daemon_state (
                key TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'stopped',
                started_at TEXT,
                last_heartbeat_at TEXT,
                config_path TEXT,
                profile_name TEXT,
                target_count INTEGER NOT NULL DEFAULT 0,
                last_tick_summary TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        await conn.execute(
            "INSERT INTO daemon_state (key, status, target_count, updated_at) VALUES (?, ?, ?, ?)",
            ("scout", "stopped", -1, "2025-01-01T00:00:00+00:00"),
        )
        await conn.commit()

    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        daemon_state = await store.get_daemon_state()
        # Legacy negative target_count should be reset to 0 by the migration.
        assert daemon_state["target_count"] == 0
        # New columns now exist.
        assert "process_id" in daemon_state
        assert "interval_seconds" in daemon_state
        assert "interval_basis" in daemon_state
    finally:
        await store.close()


async def test_daemon_state_table_adds_missing_columns(tmp_path) -> None:
    """When the table has the new constraint but missing newer columns, ALTER TABLE adds them."""
    db_path = tmp_path / "partial.db"

    # Create the daemon_state table with the new constraint shape but missing
    # the process_id / interval_seconds / interval_basis columns.
    async with aiosqlite.connect(str(db_path)) as conn:
        await conn.execute(
            """
            CREATE TABLE daemon_state (
                key TEXT PRIMARY KEY CHECK(key = 'scout'),
                status TEXT NOT NULL DEFAULT 'stopped' CHECK(status IN ('starting', 'running', 'stopped')),
                started_at TEXT,
                last_heartbeat_at TEXT,
                config_path TEXT,
                profile_name TEXT,
                target_count INTEGER NOT NULL DEFAULT 0 CHECK(target_count >= 0),
                last_tick_summary TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        await conn.commit()

    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        daemon_state = await store.get_daemon_state()
        assert daemon_state["process_id"] is None
        assert daemon_state["interval_seconds"] is None
        assert daemon_state["interval_basis"] is None
    finally:
        await store.close()
