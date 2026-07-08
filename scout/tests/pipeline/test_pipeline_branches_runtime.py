"""Branch and edge-case tests for the Scout pipeline orchestrator."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from atlas_scout.pipeline import run_pipeline
from tests.pipeline.test_pipeline_branches_support import (
    _BadVerboseThenTracked,
    _BindAsyncFetcher,
    _EmptyProvider,
    _PlainFetchFetcher,
    _PlainFetchNoneFetcher,
    _SeedFetcher,
)

if TYPE_CHECKING:
    from pathlib import Path


@pytest.mark.asyncio
async def test_run_pipeline_skips_malformed_search_results(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    """Malformed search-result rows (None url, blank url, non-string url) are skipped."""
    from atlas_scout.store import ScoutStore

    async def _fake_search(_queries, _key, **_kwargs):
        return [
            {"url": None},
            {"url": ""},
            {"url": 12345},
            {"url": "   "},
            {"url": "https://example.com/seed", "title": "Seed", "publication": "Ex"},
        ]

    monkeypatch.setattr("atlas_scout.steps.source_fetch.search_brave", _fake_search)

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        search_api_key="test-key",
        fetcher=_SeedFetcher(),
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    queued_urls = {task["url"] for task in page_tasks}
    assert queued_urls == {"https://example.com/seed"}
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_place_issue_run_requires_search_or_local_articles(
    tmp_db_path: Path,
) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    with pytest.raises(ValueError, match="Connect search or build a local article corpus"):
        await run_pipeline(
            location="Austin, TX",
            issues=["housing_affordability"],
            provider=_EmptyProvider(),
            store=store,
            search_api_key="",
        )

    runs = await store.list_runs()
    assert runs[0]["status"] == "failed"
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_awaits_async_bind_run(tmp_db_path: Path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    fetcher = _BindAsyncFetcher()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=fetcher,
    )

    assert fetcher.bound_runs == [result.run_id]
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_skips_blank_direct_url_entries(
    tmp_db_path: Path,
) -> None:
    """Blank direct URLs are normalized to empty strings and skipped without crashing."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["   ", "https://example.com/seed"],
        fetcher=_SeedFetcher(),
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    assert len(page_tasks) == 1
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_falls_back_to_plain_fetch_when_no_tracked_methods(
    tmp_db_path: Path,
) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/plain"],
        fetcher=_PlainFetchFetcher(),
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    # Status progresses through fetched → extracted/extract_empty by the time the
    # run finishes; what matters is that the page task was successfully processed.
    assert page_tasks[0]["status"] in {"fetched", "extracted", "extract_empty"}
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_plain_fetch_returns_none_filters_task(
    tmp_db_path: Path,
) -> None:
    """Plain fetch returning None marks the page task filtered without crashing."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/missing"],
        fetcher=_PlainFetchNoneFetcher(),
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    assert page_tasks[0]["status"] == "filtered"
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_falls_back_to_fetch_tracked_when_verbose_returns_non_dict(
    tmp_db_path: Path,
) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_BadVerboseThenTracked(),
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    # Status progresses through fetched → extracted/extract_empty by the time the
    # run finishes; what matters is that the page task was successfully processed.
    assert page_tasks[0]["status"] in {"fetched", "extracted", "extract_empty"}
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_closes_default_fetcher_when_owned(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    closed_runs: list[str] = []

    class _OwnedFetcher:
        max_concurrent = 1

        def __init__(self, *, store, run_id: str) -> None:
            self.store = store
            self.run_id = run_id

        async def fetch_tracked(self, _url: str, _task_id: str, _store) -> None:
            return None

        async def close(self) -> None:
            closed_runs.append(self.run_id)

    monkeypatch.setattr("atlas_scout.scraper.fetcher.AsyncFetcher", _OwnedFetcher)

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        # No fetcher passed → pipeline owns the default and must close it.
    )

    assert closed_runs == [result.run_id]
    await store.close()
