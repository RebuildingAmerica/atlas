"""Tests for atlas_scout.store.ScoutStore."""

import pytest

from atlas_scout.store import ScoutStore


@pytest.fixture
async def store(tmp_db_path):
    s = ScoutStore(str(tmp_db_path))
    await s.initialize()
    yield s
    await s.close()


async def test_initialize_creates_tables(store):
    tables = await store.list_tables()
    assert "runs" in tables
    assert "pages" in tables
    assert "entries" in tables


async def test_create_and_get_run(store):
    run_id = await store.create_run(
        location="Austin, TX",
        issues=["housing_affordability"],
        search_depth="standard",
    )
    assert run_id is not None
    run = await store.get_run(run_id)
    assert run["location"] == "Austin, TX"
    assert run["status"] == "pending"


async def test_update_run_status(store):
    run_id = await store.create_run(
        location="Austin, TX", issues=[], search_depth="standard"
    )
    await store.update_run_status(run_id, "running")
    run = await store.get_run(run_id)
    assert run["status"] == "running"


async def test_complete_run_with_stats(store):
    run_id = await store.create_run(
        location="Austin, TX", issues=[], search_depth="standard"
    )
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


async def test_page_cache_miss_then_hit(store):
    cached = await store.get_cached_page("https://example.com")
    assert cached is None
    await store.cache_page("https://example.com", "Hello world", {"title": "Example"})
    cached = await store.get_cached_page("https://example.com")
    assert cached is not None
    assert cached["text"] == "Hello world"


async def test_page_cache_respects_ttl(store):
    await store.cache_page("https://example.com", "Hello", {})
    await store._execute(
        "UPDATE pages SET fetched_at = datetime('now', '-30 days') WHERE url = ?",
        ("https://example.com",),
    )
    cached = await store.get_cached_page("https://example.com", ttl_days=7)
    assert cached is None


async def test_save_and_list_entries(store):
    run_id = await store.create_run(
        location="Austin, TX", issues=[], search_depth="standard"
    )
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


async def test_list_runs(store):
    await store.create_run(
        location="Austin, TX", issues=[], search_depth="standard"
    )
    await store.create_run(
        location="Houston, TX", issues=[], search_depth="deep"
    )
    runs = await store.list_runs()
    assert len(runs) == 2
