"""Bounded crawls preserve Scout frontier rules and durable evidence ownership."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest
from atlas_discovery_engine.web_content import ContentExtraction
from atlas_shared import PageContent
from pydantic import TypeAdapter

from atlas.domains.discovery.pipeline import crawl_checkpoints as crawl
from atlas.domains.discovery.pipeline.web_checkpoints import CheckpointLeaseLostError, _Checkpoints
from atlas.platform.database import get_db_connection

from .test_web_checkpoints import _claim, _settings


def _page(url: str, links: list[str] | None = None) -> ContentExtraction:
    links = links or []
    return ContentExtraction(
        PageContent(
            url=url,
            text="Public source evidence",
            discovered_links=links,
            title="Council",
            publication="Civic News",
            structured_data={"opengraph": {"type": "article"}},
        ),
        None,
        links,
    )


async def _store(conn, owner="alarm-1") -> _Checkpoints:
    job_id, job = await _claim(conn)
    return _Checkpoints(conn, job_id, owner, job.run_id, "crawl-test")


@pytest.mark.asyncio
async def test_restart_preserves_roots_filtered_links_depth_and_metadata(
    test_db, db_url, monkeypatch
) -> None:
    store = await _store(test_db)
    root, other = "https://example.org", "https://example.org/other"
    replies = {
        root: ContentExtraction(
            None, "content_below_min_words", [root + "/one", other, "https://other.org"]
        ),
        other: _page(other, [root + "/one#fragment"]),
        root + "/one": _page(root + "/one", [root + "/two"]),
        root + "/two": _page(root + "/two", [root + "/three"]),
    }
    fetch = AsyncMock(side_effect=lambda url: replies[url])
    monkeypatch.setattr(crawl, "fetch_direct_page", fetch)
    seeds = [root + "/#fragment", other, root]
    # Fresh connection and owner on every invocation prove process-local state
    # is unnecessary and reserved roots win over children from an earlier seed.
    for index in range(4):
        owner = f"owner-{index}"
        await test_db.execute(
            "UPDATE discovery_jobs SET claimed_by = ? WHERE id = ?", (owner, store.job_id)
        )
        await test_db.commit()
        connection = await get_db_connection(db_url)
        try:
            fresh = _Checkpoints(connection, store.job_id, owner, store.run_id, store.fingerprint)
            assert await crawl.advance_crawl(fresh, seeds=seeds, settings=_settings()) is None
        finally:
            await connection.close()
        assert fetch.await_count == index + 1
    store.owner = owner
    result = await crawl.advance_crawl(store, seeds=seeds, settings=_settings())
    assert [task.url for task in result.tasks] == list(replies)
    assert [task.depth for task in result.tasks] == [0, 0, 1, 2]
    assert [task.seed_url for task in result.tasks] == [root, other, root, root]
    assert result.tasks[0].status == "filtered"
    assert result.tasks[0].error == "content_below_min_words"
    assert result.tasks[-1].discovered_from == root + "/one"
    assert result.pages[0].title == "Council"
    assert result.pages[0].task_id == other
    assert result.pages[0].structured_data == {"opengraph": {"type": "article"}}
    assert await crawl.advance_crawl(store, seeds=seeds, settings=_settings()) == result
    assert fetch.await_count == 4
    cursor = await test_db.execute("SELECT COUNT(*) FROM cost_ledger")
    assert (await cursor.fetchone())[0] == 0


@pytest.mark.asyncio
async def test_twenty_page_cap_counts_failed_pages_and_deduplicates_globally(
    test_db, monkeypatch
) -> None:
    store = await _store(test_db)
    root = "https://example.org"

    async def fetch(url) -> ContentExtraction:
        if url == root:
            return _page(root, [f"{root}/{index}" for index in range(30)])
        return ContentExtraction(None, "fetch_failed", [])

    mocked = AsyncMock(side_effect=fetch)
    monkeypatch.setattr(crawl, "fetch_direct_page", mocked)
    for _ in range(20):
        assert await crawl.advance_crawl(store, seeds=[root], settings=_settings()) is None
    result = await crawl.advance_crawl(store, seeds=[root], settings=_settings())
    assert len(result.tasks) == mocked.await_count == 20
    assert len(result.pages) == 1
    assert all(task.status == "fetch_failed" for task in result.tasks[1:])


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["cancel", "stolen", "interrupted"])
async def test_uncommitted_fetch_never_advances_frontier(test_db, monkeypatch, outcome) -> None:
    store = await _store(test_db)
    url = "https://example.org"

    async def fetch(url) -> ContentExtraction:
        if outcome == "interrupted":
            raise asyncio.CancelledError
        await test_db.execute(
            "UPDATE discovery_jobs SET status = ?, claimed_by = ? WHERE id = ?",
            ("cancelled" if outcome == "cancel" else "running", "other", store.job_id),
        )
        await test_db.commit()
        return _page(url, [url + "/child"])

    monkeypatch.setattr(crawl, "fetch_direct_page", fetch)
    with pytest.raises(
        asyncio.CancelledError if outcome == "interrupted" else CheckpointLeaseLostError
    ):
        await crawl.advance_crawl(store, seeds=[url], settings=_settings())
    await test_db.execute(
        "UPDATE discovery_jobs SET status = 'running', claimed_by = 'alarm-1' WHERE id = ?",
        (store.job_id,),
    )
    await test_db.commit()
    state = await store.load("crawl", TypeAdapter(crawl.CrawlCheckpoint))
    assert state.cursor == 0
    assert state.pages == []
    assert len(state.tasks) == 1
    fetch = AsyncMock(return_value=_page(url))
    monkeypatch.setattr(crawl, "fetch_direct_page", fetch)
    assert await crawl.advance_crawl(store, seeds=[url], settings=_settings()) is None
    assert len((await crawl.advance_crawl(store, seeds=[url], settings=_settings())).pages) == 1
    assert fetch.await_count == 1


@pytest.mark.asyncio
async def test_kill_switch_and_empty_seeds_never_fetch(test_db, monkeypatch) -> None:
    store = await _store(test_db)
    fetch = AsyncMock()
    monkeypatch.setattr(crawl, "fetch_direct_page", fetch)
    assert (await crawl.advance_crawl(store, seeds=[], settings=_settings())).tasks == []
    # Seed list is included in the caller's fingerprint; use a separate run.
    store = await _store(test_db)
    settings = _settings().model_copy(update={"discovery_cost_kill_switch": True})
    from atlas.domains.discovery.cost import CostCeilingExceeded

    with pytest.raises(CostCeilingExceeded):
        await crawl.advance_crawl(store, seeds=["https://example.org"], settings=settings)
    fetch.assert_not_awaited()


@pytest.mark.asyncio
async def test_lost_commit_ack_reuses_saved_page_and_frontier(test_db, monkeypatch) -> None:
    store = await _store(test_db)
    fetch = AsyncMock(return_value=_page("https://example.org"))
    monkeypatch.setattr(crawl, "fetch_direct_page", fetch)
    save = store.save

    async def lose_ack(key, value, adapter) -> None:
        await save(key, value, adapter)
        if value.cursor == 1:
            message = "acknowledgement lost"
            raise ConnectionError(message)

    monkeypatch.setattr(store, "save", lose_ack)
    with pytest.raises(ConnectionError, match="acknowledgement"):
        await crawl.advance_crawl(store, seeds=["https://example.org"], settings=_settings())
    fresh = _Checkpoints(test_db, store.job_id, store.owner, store.run_id, store.fingerprint)
    result = await crawl.advance_crawl(fresh, seeds=["https://example.org"], settings=_settings())
    assert len(result.pages) == 1
    assert fetch.await_count == 1


@pytest.mark.asyncio
async def test_concurrent_replacement_keeps_new_owner_evidence(
    test_db, db_url, monkeypatch
) -> None:
    store = await _store(test_db)
    started, release = asyncio.Event(), asyncio.Event()
    attempts = 0

    async def fetch(url) -> ContentExtraction:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            started.set()
            await release.wait()
            return _page(url, [url + "/stale"])
        return _page(url, [url + "/current"])

    monkeypatch.setattr(crawl, "fetch_direct_page", fetch)
    stale = asyncio.create_task(
        crawl.advance_crawl(store, seeds=["https://example.org"], settings=_settings())
    )
    await started.wait()
    other = await get_db_connection(db_url)
    try:
        await other.execute(
            "UPDATE discovery_jobs SET claimed_by = 'replacement' WHERE id = ?", (store.job_id,)
        )
        await other.commit()
        replacement = _Checkpoints(
            other, store.job_id, "replacement", store.run_id, store.fingerprint
        )
        assert (
            await crawl.advance_crawl(
                replacement, seeds=["https://example.org"], settings=_settings()
            )
            is None
        )
        release.set()
        with pytest.raises(CheckpointLeaseLostError):
            await stale
        state = await replacement.load("crawl", TypeAdapter(crawl.CrawlCheckpoint))
        assert state.cursor == 1
        assert [task.url for task in state.tasks] == [
            "https://example.org",
            "https://example.org/current",
        ]
        assert state.pages[0].discovered_links == ["https://example.org/current"]
    finally:
        release.set()
        await other.close()
