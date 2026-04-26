"""Tests for atlas_scout.store.ScoutStore."""

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
