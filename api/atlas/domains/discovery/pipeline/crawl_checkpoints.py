"""A durable, one-page-at-a-time frontier using Scout's public-source rules."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas_discovery_engine.web_content import normalize_url, same_domain
from atlas_shared import PageContent, PageTaskOutcome
from pydantic import BaseModel, Field, TypeAdapter

from atlas.domains.discovery.cost import assert_within_budget

from .direct_sources import fetch_direct_page

if TYPE_CHECKING:
    from atlas.platform.config import Settings

    from .web_checkpoints import _Checkpoints

MAX_LINK_DEPTH = 2
MAX_PAGES_PER_SEED = 20


class CrawlCheckpoint(BaseModel):
    """Committed frontier and provenance; no credentials or runtime objects."""

    tasks: list[PageTaskOutcome] = Field(default_factory=list)
    pages: list[PageContent] = Field(default_factory=list)
    cursor: int = 0

    def enqueue(self, url: str, *, depth: int, seed: str, parent: str | None) -> None:
        """Reserve each URL once, counting queued/failed pages against the cap."""
        url = normalize_url(url)
        if not url or any(task.url == url for task in self.tasks):
            return
        if sum(task.seed_url == seed for task in self.tasks) >= MAX_PAGES_PER_SEED:
            return
        self.tasks.append(
            PageTaskOutcome(
                task_id=url,
                url=url,
                status="queued",
                depth=depth,
                seed_url=seed,
                discovered_from=parent,
                user_visible=parent is None,
            )
        )


async def advance_crawl(
    store: _Checkpoints, *, seeds: list[str], settings: Settings
) -> CrawlCheckpoint | None:
    """Fetch at most one page and fence its evidence plus frontier together.

    Parameters
    ----------
    store
        Invocation-owned leased checkpoint store; no transaction spans HTTP.
    seeds
        Explicit source URLs. All roots reserve their place before children.
    settings
        Existing run budget and kill switch, checked before every page request.

    Returns
    -------
    CrawlCheckpoint | None
        Complete retained crawl, or None when a later invocation must resume.
        Failed and filtered pages retain provenance and consume frontier slots.
    """
    adapter = TypeAdapter(CrawlCheckpoint)
    state = await store.load("crawl", adapter)
    if state is None:
        state = CrawlCheckpoint()
        for seed in seeds:
            state.enqueue(seed, depth=0, seed=normalize_url(seed), parent=None)
        await store.save("crawl", state, adapter)
    if state.cursor >= len(state.tasks):
        return state

    await store.fence()
    try:
        await assert_within_budget(store.conn, run_id=store.run_id, settings=settings)
    except BaseException:
        await store.conn.execute("ROLLBACK")
        raise
    await store.conn.commit()
    task = state.tasks[state.cursor]
    result = await fetch_direct_page(task.url)
    if result.page is not None:
        result.page.task_id = task.task_id
        state.pages.append(result.page)
        task.status = "fetched"
        task.user_visible = True
    else:
        task.status = "fetch_failed" if result.reason == "fetch_failed" else "filtered"
        task.error = result.reason
    if task.depth < MAX_LINK_DEPTH:
        for link in result.discovered_links:
            if same_domain(task.url, link):
                state.enqueue(
                    link, depth=task.depth + 1, seed=task.seed_url or task.url, parent=task.url
                )
    state.cursor += 1
    await store.save("crawl", state, adapter)
    return None
