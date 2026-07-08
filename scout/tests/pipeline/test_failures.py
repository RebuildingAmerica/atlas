"""Tests for pipeline failure and cancellation handling."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import patch

import pytest

from atlas_scout.pipeline import run_pipeline
from atlas_scout.store import ScoutStore

from .support import MockFetcher, build_mock_provider


@pytest.mark.asyncio
async def test_run_pipeline_marks_run_failed_on_error(
    tmp_db_path: Path,
):
    """When the pipeline raises an unhandled error, the run should be marked failed."""
    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    with (
        patch(
            "atlas_scout.pipeline.analyze_gaps",
            side_effect=RuntimeError("gap analysis exploded"),
        ),
        pytest.raises(RuntimeError, match="gap analysis exploded"),
    ):
        await run_pipeline(
            location="Austin, TX",
            issues=["housing_affordability"],
            provider=build_mock_provider(),
            store=store,
            direct_urls=["https://example.com/article"],
            fetcher=MockFetcher(),
            follow_links=False,
        )

    runs = await store.list_runs()
    assert len(runs) == 1
    assert runs[0]["status"] == "failed"
    assert "gap analysis exploded" in runs[0]["error"]

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_marks_run_cancelled_on_interrupt(
    tmp_db_path: Path,
):
    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    async def cancelled_rank(*_args, **_kwargs):
        raise asyncio.CancelledError()
        yield  # pragma: no cover

    with (
        patch("atlas_scout.pipeline.rank_entries_stream", side_effect=cancelled_rank),
        pytest.raises(asyncio.CancelledError),
    ):
        await run_pipeline(
            location="Austin, TX",
            issues=["housing_affordability"],
            provider=build_mock_provider(),
            store=store,
            direct_urls=["https://example.com/article"],
            fetcher=MockFetcher(),
            follow_links=False,
        )

    runs = await store.list_runs()
    assert len(runs) == 1
    assert runs[0]["status"] == "cancelled"

    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_cancels_workers_before_returning_on_interrupt(
    tmp_db_path: Path,
):
    started = asyncio.Event()

    class _SinglePageFetcher:
        max_concurrent = 1

        async def fetch_tracked(self, url: str, task_id: str, _store) -> object:
            from atlas_shared import PageContent

            return PageContent(
                url=url,
                title="Seed",
                text="Tenant defense organizers are active locally. " * 80,
                task_id=task_id,
            )

    class _BlockingProvider:
        max_concurrent = 1

        async def complete(self, _messages, _response_schema=None):
            started.set()
            await asyncio.Future()
            return None  # pragma: no cover

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    task = asyncio.create_task(
        run_pipeline(
            location="Austin, TX",
            issues=["housing_affordability"],
            provider=_BlockingProvider(),
            store=store,
            direct_urls=["https://example.com/seed"],
            fetcher=_SinglePageFetcher(),
        )
    )

    # Wait for the provider to start, then cancel the pipeline.
    await asyncio.wait_for(started.wait(), timeout=1.0)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task

    await asyncio.sleep(0)

    worker_tasks = [
        pending
        for pending in asyncio.all_tasks()
        if pending is not asyncio.current_task()
        and getattr(pending.get_coro(), "__name__", "") in {"fetch_worker", "extract_worker"}
        and not pending.done()
    ]
    assert worker_tasks == []

    runs = await store.list_runs()
    assert len(runs) == 1
    assert runs[0]["status"] == "cancelled"

    await store.close()
