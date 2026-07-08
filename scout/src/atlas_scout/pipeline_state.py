"""Shared runtime state for the Scout pipeline."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable
    from datetime import datetime

    from atlas_shared import DiscoveryRunArtifacts, GapReport, PageContent, RankedEntry, RawEntry

    from atlas_scout.config import ContributionConfig
    from atlas_scout.providers.base import LLMProvider
    from atlas_scout.scraper.fetcher import AsyncFetcher
    from atlas_scout.store import ScoutStore


@dataclass(slots=True)
class PipelineResult:
    """Summary of a completed discovery pipeline run."""

    run_id: str
    queries_generated: int
    pages_fetched: int
    entries_found: int
    entries_after_dedup: int
    ranked_entries: list[RankedEntry]
    gap_report: GapReport
    page_outcomes: list[dict[str, object]] = field(default_factory=list)
    artifacts: DiscoveryRunArtifacts | None = None


@dataclass(slots=True)
class _FrontierItem:
    """Queued page to fetch and/or extract."""

    url: str
    depth: int
    seed_url: str
    task_id: str
    discovered_from: str | None = None


@dataclass(slots=True)
class PipelineState:
    """Mutable state shared across pipeline phases and workers."""

    run_id: str
    location: str
    issues: list[str]
    provider: LLMProvider
    store: ScoutStore
    city: str
    state: str
    search_api_key: str
    search_depth: str
    min_entry_score: float
    reuse_cached_extractions: bool
    fetcher: AsyncFetcher
    direct_urls: list[str] | None
    on_progress: Callable[[str, dict[str, object]], None] | None
    extraction_directive: str | None
    search_concurrency: int | None
    follow_links: bool
    max_link_depth: int
    max_pages_per_seed: int
    iterative_deepening: bool
    contribution_config: ContributionConfig | None
    remote_run_id: str | None
    structured_columns: list[str] | None
    target_count: int | None
    own_fetcher: bool
    started_at: datetime
    frontier_queue: asyncio.Queue[_FrontierItem | None]
    extract_queue: asyncio.PriorityQueue[tuple[int, int, PageContent | None]]
    frontier_lock: asyncio.Lock
    queries_count: int = 0
    raw_entries: list[RawEntry] = field(default_factory=list)
    ranked_entries: list[RankedEntry] = field(default_factory=list)
    deduped_entries_count: int = 0
    fetched_pages_by_url: dict[str, PageContent] = field(default_factory=dict)
    seen_urls: set[str] = field(default_factory=set)
    seed_counts: dict[str, int] = field(default_factory=dict)
    page_outcomes_by_task: dict[str, dict[str, object]] = field(default_factory=dict)
    visible_page_tasks: set[str] = field(default_factory=set)
    extract_order: int = 0
    stats: dict[str, int] = field(
        default_factory=lambda: {
            "fetch_active": 0,
            "extract_active": 0,
            "pages_fetched": 0,
        }
    )
    effective_target_count: int | None = None
    phase: dict[str, str] = field(default_factory=lambda: {"value": "starting"})
    status_stop: asyncio.Event = field(default_factory=asyncio.Event)

    def emit(self, event: str, payload: dict[str, object]) -> None:
        """Forward a progress event to the caller, if one was supplied."""
        if self.on_progress is None:
            return
        try:
            self.on_progress(event, payload)
        except Exception:
            # Progress telemetry must never break discovery.
            return

    def target_reached(self) -> bool:
        """Return whether the run has already collected enough entries."""
        return (
            self.effective_target_count is not None
            and len(self.raw_entries) >= self.effective_target_count
        )

    def set_phase(self, value: str) -> None:
        """Update the current high-level pipeline phase."""
        self.phase["value"] = value
