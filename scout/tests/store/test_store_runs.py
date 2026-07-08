"""Run, cache, and entry coverage for atlas_scout.store.ScoutStore."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from atlas_shared import (
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoverySyncInfo,
)

if TYPE_CHECKING:
    from atlas_scout.store import ScoutStore


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
    await store._db.execute(
        "UPDATE pages SET fetched_at = datetime('now', '-30 days') WHERE url = ?",
        ("https://example.com",),
    )
    cached = await store.get_cached_page("https://example.com", ttl_days=7)
    assert cached is None


async def test_page_cache_can_ignore_ttl(store: ScoutStore) -> None:
    await store.cache_page("https://example.com", "Hello", {})
    await store._db.execute(
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


async def test_purge_entries_by_source_dataset_removes_matching_rows(
    store: ScoutStore,
) -> None:
    """Purging source-dataset rows removes them from active entries."""
    run_id = await store.create_run(location="Las Vegas, NV", issues=[], search_depth="standard")
    await store.save_entry(
        run_id=run_id,
        name="IRS Person",
        entry_type="person",
        description="Structured filing person",
        city="Las Vegas",
        state="NV",
        score=0.82,
        data={
            "source_dataset": "irs_990_people",
            "source_key": "irs-990:test",
            "source_urls": ["file://sample.zip#sample.xml"],
        },
    )
    await store.save_entry(
        run_id=run_id,
        name="Web Person",
        entry_type="person",
        description="Discovered from a web source",
        city="Las Vegas",
        state="NV",
        score=0.9,
        data={
            "source_urls": ["https://example.org"],
            "source_contexts": {"https://example.org": "Web Person said ..."},
        },
    )

    count = await store.count_entries_by_source_dataset("irs_990_people")
    deleted = await store.purge_entries_by_source_dataset("irs_990_people")
    active_entries = await store.list_entries()
    stats = await store.entry_stats()

    assert count == 1
    assert deleted == 1
    assert [entry["name"] for entry in active_entries] == ["Web Person"]
    assert stats["by_source_dataset"] == {}
    assert stats["by_location"] == {"Las Vegas, NV": 1}


async def test_entry_stats_reports_unique_people_and_exact_duplicates(
    store: ScoutStore,
) -> None:
    """Stats distinguish run artifacts from exact unique person keys."""
    first_run_id = await store.create_run(
        location="United States", issues=[], search_depth="standard"
    )
    second_run_id = await store.create_run(
        location="United States", issues=[], search_depth="standard"
    )
    for run_id, source_url in (
        (first_run_id, "https://example.gov/candidates.csv"),
        (second_run_id, "https://example.gov/contributions.csv"),
    ):
        await store.save_entry(
            run_id=run_id,
            name="Jane Doe",
            entry_type="person",
            description="Source-backed person",
            city="Dallas",
            state="TX",
            score=0.8,
            data={
                "source_urls": [source_url],
                "source_contexts": {source_url: "name=DOE, JANE; city=Dallas; state=TX"},
            },
        )

    stats = await store.entry_stats()

    assert stats["by_type"] == {"person": 2}
    assert stats["exact_duplicate_groups"] == 1
    assert stats["exact_duplicate_surplus"] == 1
    assert stats["unique_person_keys"] == 1


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


async def test_list_syncable_run_ids_returns_completed_unsynced_artifacts(
    store: ScoutStore,
) -> None:
    """Only completed runs with unsynced artifacts should be queued for turnkey sync."""
    ready_run = await store.create_run(
        location="Austin, TX",
        issues=["housing_affordability"],
        search_depth="standard",
    )
    synced_run = await store.create_run(
        location="Dallas, TX",
        issues=["housing_affordability"],
        search_depth="standard",
    )
    pending_run = await store.create_run(
        location="Houston, TX",
        issues=["housing_affordability"],
        search_depth="standard",
    )

    for run_id, location in (
        (ready_run, "Austin, TX"),
        (synced_run, "Dallas, TX"),
        (pending_run, "Houston, TX"),
    ):
        await store.save_run_artifacts(
            run_id,
            DiscoveryRunArtifacts(
                manifest=DiscoveryRunManifest(
                    runner="atlas-scout",
                    run=DiscoveryRunInput(
                        location_query=location,
                        state="TX",
                        issue_areas=["housing_affordability"],
                    ),
                    status="completed",
                    sync=DiscoverySyncInfo(local_run_id=run_id, sync_status="ready"),
                )
            ),
        )

    await store.complete_run(
        ready_run,
        queries=1,
        pages_fetched=1,
        entries_found=1,
        entries_after_dedup=1,
    )
    await store.complete_run(
        synced_run,
        queries=1,
        pages_fetched=1,
        entries_found=1,
        entries_after_dedup=1,
    )
    await store.update_run_sync(
        synced_run,
        sync_status="synced",
        remote_run_id="remote_123",
    )

    assert await store.list_syncable_run_ids(limit=10) == [ready_run]
    assert set(await store.list_syncable_run_ids(limit=10, include_synced=True)) == {
        ready_run,
        synced_run,
    }


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

    found = await store.find_running_direct_run(["https://example.com/a", "https://example.com/b"])
    assert found == run_id


async def test_find_running_direct_run_no_match(store: ScoutStore) -> None:
    """Non-matching URLs return None."""
    run_id = await store.create_run(location="", issues=[], search_depth="standard")
    await store.update_run_status(run_id, "running")
    await store.create_page_task(run_id, "https://example.com/x")

    assert await store.find_running_direct_run(["https://example.com/y"]) is None
