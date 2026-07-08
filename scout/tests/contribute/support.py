"""Shared helpers for contribution tests."""

from __future__ import annotations

from datetime import date

from atlas_shared import (
  DeduplicatedEntry,
  DiscoveryRunArtifacts,
  DiscoveryRunInput,
  DiscoveryRunManifest,
  DiscoveryRunStats,
  DiscoverySyncInfo,
  PageContent,
  RankedEntry,
  SourceType,
)


def build_ranked_entry(
  *,
  name: str,
  score: float,
  city: str,
  state: str,
  source_url: str = "https://example.com",
  source_context: str = "ctx",
  issue_areas: list[str] | None = None,
) -> RankedEntry:
  return RankedEntry(
    entry=DeduplicatedEntry(
      name=name,
      entry_type="organization",
      description="d",
      city=city,
      state=state,
      issue_areas=issue_areas or ["housing_affordability"],
      source_urls=[source_url],
      source_dates=[date(2026, 1, 1)],
      source_contexts={source_url: source_context},
      last_seen=date(2026, 1, 1),
    ),
    score=score,
  )


def build_stats() -> DiscoveryRunStats:
  return DiscoveryRunStats(
    queries_generated=1,
    sources_fetched=1,
    sources_processed=1,
    entries_extracted=1,
    entries_after_dedup=1,
    entries_confirmed=1,
  )


def build_source() -> PageContent:
  return PageContent(
    url="https://example.com/story",
    title="Prairie workers launch co-op",
    text="A worker-owned cooperative opened in Garden City.",
    source_type=SourceType.NEWS_ARTICLE,
  )


def build_sync_artifacts(local_run_id: str, status: str = "ready") -> DiscoveryRunArtifacts:
  return DiscoveryRunArtifacts(
    manifest=DiscoveryRunManifest(
      runner="atlas-scout",
      run=DiscoveryRunInput(
        location_query="Austin, TX",
        state="TX",
        issue_areas=["housing_affordability"],
      ),
      status="completed",
      sync=DiscoverySyncInfo(local_run_id=local_run_id, sync_status=status),
    )
  )
