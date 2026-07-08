"""Page and task coverage for atlas_scout.store.ScoutStore."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from atlas_scout.store import ScoutStore


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
    """The RunsRepository.run_status helper short-circuits for anonymous owners."""
    assert await store._runs.run_status("") is None
    assert await store._runs.run_status("anonymous") is None


async def test_run_status_returns_none_for_missing_run(store: ScoutStore) -> None:
    """When no run exists for the given id, run_status returns None."""
    assert await store._runs.run_status("nonexistent-run") is None


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
