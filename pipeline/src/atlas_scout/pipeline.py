"""
Streaming pipeline orchestrator for Atlas Scout.

Composes all 6 steps into a single async pipeline:
  1. Query generation
  2. Source fetching (streaming)
  3. Entry extraction (streaming)
  4. Deduplication (streaming)
  5. Ranking (streaming)
  6. Gap analysis (materialised)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from atlas_shared import RankedEntry
from atlas_scout.steps.dedup import deduplicate_stream
from atlas_scout.steps.entry_extract import extract_entries_stream
from atlas_scout.steps.gap_analysis import analyze_gaps
from atlas_scout.steps.query_gen import generate_queries, generate_queries_stream
from atlas_scout.steps.rank import rank_entries_stream
from atlas_scout.steps.source_fetch import fetch_sources_stream

if TYPE_CHECKING:
    from atlas_shared import GapReport
    from atlas_scout.providers.base import LLMProvider
    from atlas_scout.scraper.fetcher import AsyncFetcher
    from atlas_scout.store import ScoutStore

logger = logging.getLogger(__name__)

__all__ = ["PipelineResult", "run_pipeline"]


@dataclass
class PipelineResult:
    """Summary of a completed discovery pipeline run."""

    run_id: str
    queries_generated: int
    pages_fetched: int
    entries_found: int
    entries_after_dedup: int
    ranked_entries: list[RankedEntry]
    gap_report: GapReport


async def run_pipeline(
    *,
    location: str,
    issues: list[str],
    provider: LLMProvider,
    store: ScoutStore,
    search_api_key: str,
    search_depth: str = "standard",
    min_entry_score: float = 0.3,
    fetcher: AsyncFetcher | None = None,
) -> PipelineResult:
    """
    Run the full Atlas Scout discovery pipeline for a location and set of issues.

    Parameters
    ----------
    location : str
        Location string in "City, ST" format (e.g. "Austin, TX").
    issues : list[str]
        Issue area slugs to discover content for.
    provider : LLMProvider
        LLM provider for entry extraction.
    store : ScoutStore
        Local SQLite store for persisting run state and entries.
    search_api_key : str
        Brave Search API key.
    search_depth : str
        Pipeline depth hint ("standard" or "deep").
    min_entry_score : float
        Minimum relevance score for an entry to be kept (0.0–1.0).
    fetcher : AsyncFetcher | None
        Optional pre-configured HTTP fetcher. Created automatically if None.

    Returns
    -------
    PipelineResult
        Aggregated results including ranked entries and gap report.
    """
    city, state = _parse_location(location)

    run_id = await store.create_run(
        location=location, issues=issues, search_depth=search_depth
    )
    await store.update_run_status(run_id, "running")

    try:
        queries = generate_queries(city=city, state=state, issue_areas=issues)
        queries_count = len(queries)

        if fetcher is None:
            from atlas_scout.scraper.fetcher import AsyncFetcher as _AsyncFetcher

            fetcher = _AsyncFetcher(store=store)

        # --- Streaming pipeline composition ---
        pages_stream = fetch_sources_stream(
            queries=generate_queries_stream(city=city, state=state, issue_areas=issues),
            fetcher=fetcher,
            search_api_key=search_api_key,
        )
        raw_entries_stream = extract_entries_stream(
            pages=pages_stream, provider=provider, city=city, state=state
        )
        deduped_stream = deduplicate_stream(raw_entries_stream)
        ranked_stream = rank_entries_stream(deduped_stream, min_score=min_entry_score)

        ranked_entries: list[RankedEntry] = []
        async for ranked in ranked_stream:
            ranked_entries.append(ranked)
            await store.save_entry(
                run_id=run_id,
                name=ranked.entry.name,
                entry_type=str(ranked.entry.entry_type),
                description=ranked.entry.description,
                city=ranked.entry.city,
                state=ranked.entry.state,
                score=ranked.score,
                data=ranked.entry.model_dump(),
            )

        gap_report = analyze_gaps(location, ranked_entries)

        await store.complete_run(
            run_id,
            queries=queries_count,
            pages_fetched=0,
            entries_found=len(ranked_entries),
            entries_after_dedup=len(ranked_entries),
        )

        return PipelineResult(
            run_id=run_id,
            queries_generated=queries_count,
            pages_fetched=0,
            entries_found=len(ranked_entries),
            entries_after_dedup=len(ranked_entries),
            ranked_entries=ranked_entries,
            gap_report=gap_report,
        )

    except Exception as exc:
        logger.error("Pipeline failed for run %s: %s", run_id, exc)
        await store.fail_run(run_id, str(exc))
        raise


def _parse_location(location: str) -> tuple[str, str]:
    """Split "City, ST" into (city, state). State may be empty."""
    parts = location.split(",", maxsplit=1)
    city = parts[0].strip()
    state = parts[1].strip() if len(parts) > 1 else ""
    return city, state
