"""Branch and edge-case tests for the Scout pipeline orchestrator."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from atlas_scout.pipeline import run_pipeline
from tests.pipeline.test_pipeline_branches_support import (
    _CrossDomainLinkFetcher,
    _EmptyProvider,
    _FlakyProgressProvider,
    _SameDomainHeavyLinkFetcher,
    _SeedFetcher,
)

if TYPE_CHECKING:
    from pathlib import Path


@pytest.mark.asyncio
async def test_run_pipeline_swallows_progress_callback_exceptions(tmp_db_path: Path) -> None:
    """A raising on_progress callback must not crash the pipeline."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    def boom(_event: str, _payload: dict[str, object]) -> None:
        raise RuntimeError("on_progress exploded")

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_FlakyProgressProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_SeedFetcher(),
        on_progress=boom,
    )

    # The run still completes despite every progress event raising.
    assert result.run_id is not None
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_skips_cross_domain_and_blank_links(tmp_db_path: Path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_CrossDomainLinkFetcher(),
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    queued_urls = {task["url"] for task in page_tasks}
    assert "https://example.com/seed" in queued_urls
    assert "https://example.com/article" in queued_urls
    assert "https://other-domain.example/news" not in queued_urls
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_respects_max_pages_per_seed(tmp_db_path: Path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_SameDomainHeavyLinkFetcher(),
        max_pages_per_seed=2,
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    # Only 2 page tasks should exist due to max_pages_per_seed=2.
    assert len(page_tasks) == 2
    await store.close()
