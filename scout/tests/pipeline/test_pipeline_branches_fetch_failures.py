"""Branch and edge-case tests for the Scout pipeline orchestrator."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from atlas_scout.pipeline import run_pipeline
from tests.pipeline.test_pipeline_branches_support import (
    _DiscoveredLinkFilteredFetcher,
    _DiscoveredLinkRaisingFetcher,
    _EmptyProvider,
    _FilteredHubWithDuplicateLinksFetcher,
    _FilteredHubWithMixedLinksFetcher,
    _RaisingFetcher,
)

if TYPE_CHECKING:
    from pathlib import Path


@pytest.mark.asyncio
async def test_run_pipeline_skips_page_failed_emit_for_non_visible_link_fetch_failures(
    tmp_db_path: Path,
) -> None:
    """When a discovered (non-root) link fetch raises, fetch_failed is emitted but
    page_failed is NOT (the task isn't user-visible at that point)."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    events: list[tuple[str, dict[str, object]]] = []

    def on_progress(event: str, payload: dict[str, object]) -> None:
        events.append((event, payload))

    await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_DiscoveredLinkRaisingFetcher(),
        on_progress=on_progress,
    )

    fetch_failed_payloads = [payload for name, payload in events if name == "fetch_failed"]
    assert any(
        payload.get("url") == "https://example.com/article" for payload in fetch_failed_payloads
    )
    page_failed_payloads = [payload for name, payload in events if name == "page_failed"]
    # The seed never fails, and the article task is non-visible at the time of failure.
    assert all(
        payload.get("url") != "https://example.com/article" for payload in page_failed_payloads
    )
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_skips_page_skipped_emit_for_non_visible_link_filtered_fetch(
    tmp_db_path: Path,
) -> None:
    """When a discovered link fetch returns a filtered outcome, fetch_skipped fires
    but page_skipped is suppressed because the task isn't user-visible yet."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    events: list[tuple[str, dict[str, object]]] = []

    def on_progress(event: str, payload: dict[str, object]) -> None:
        events.append((event, payload))

    await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_DiscoveredLinkFilteredFetcher(),
        on_progress=on_progress,
    )

    fetch_skipped_payloads = [payload for name, payload in events if name == "fetch_skipped"]
    assert any(
        payload.get("url") == "https://example.com/article" for payload in fetch_skipped_payloads
    )
    page_skipped_payloads = [payload for name, payload in events if name == "page_skipped"]
    # The article was a discovered link, not user-visible → page_skipped suppressed.
    assert all(
        payload.get("url") != "https://example.com/article" for payload in page_skipped_payloads
    )
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_filtered_hub_dedupes_repeated_links_in_loop(
    tmp_db_path: Path,
) -> None:
    """A filtered hub whose discovered_links contains the same URL twice should
    only queue it once — the second iteration goes through the `if queued: False`
    branch."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/hub"],
        fetcher=_FilteredHubWithDuplicateLinksFetcher(),
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    queued_urls = [task["url"] for task in page_tasks]
    # The duplicate should appear exactly once.
    assert queued_urls.count("https://example.com/dup") == 1
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_follows_links_from_filtered_hub_with_mixed_link_kinds(
    tmp_db_path: Path,
) -> None:
    """Filtered (non-Content) hub with duplicate, cross-domain, and unique links
    should queue only the unique same-domain link."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    fetcher = _FilteredHubWithMixedLinksFetcher()
    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/hub"],
        fetcher=fetcher,
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    queued_urls = {task["url"] for task in page_tasks}
    assert "https://example.com/hub" in queued_urls
    assert "https://example.com/dup" in queued_urls
    assert "https://example.com/article" in queued_urls
    # Cross-domain link should never be queued.
    assert "https://other-domain.example/cross" not in queued_urls
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_records_fetch_exceptions(tmp_db_path: Path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    events: list[tuple[str, dict[str, object]]] = []

    def on_progress(event: str, payload: dict[str, object]) -> None:
        events.append((event, payload))

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_RaisingFetcher(),
        on_progress=on_progress,
    )

    page_tasks = await store.list_page_tasks(result.run_id)
    assert page_tasks[0]["status"] == "fetch_failed"
    failure_payload = next(payload for name, payload in events if name == "fetch_failed")
    assert "network exploded" in str(failure_payload["reason"])
    page_failed_payload = next(payload for name, payload in events if name == "page_failed")
    assert "network exploded" in str(page_failed_payload["reason"])
    await store.close()
