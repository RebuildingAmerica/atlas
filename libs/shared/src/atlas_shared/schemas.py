"""
Shared Pydantic schemas for the Atlas pipeline and API.

These models represent the data structures passed between pipeline stages
and stored in the local SQLite store.
"""

from __future__ import annotations

import json
from hashlib import sha256
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field

from atlas_shared.types import DiscoveryRunStatus, EntityType, GeoSpecificity, SourceType

__all__ = [
    "CoverageGap",
    "DiscoveryContributionRequest",
    "DiscoveryContributionResponse",
    "DiscoveryRunArtifacts",
    "DiscoveryRunInput",
    "DiscoveryRunManifest",
    "DiscoveryRunSyncRequest",
    "DiscoveryRunSyncResponse",
    "DiscoveryRunStats",
    "DiscoverySyncInfo",
    "compute_artifact_hash",
    "DeduplicatedEntry",
    "GapReport",
    "PageContent",
    "PageTaskOutcome",
    "RankedEntry",
    "RawEntry",
    "RunCheckpoint",
]


class RawEntry(BaseModel):
    """A single entry extracted from a source page, before deduplication."""

    name: str = Field(..., description="Name of the person, organization, or initiative.")
    entry_type: EntityType = Field(..., description="Entity type.")
    description: str = Field(default="", description="1-3 sentence description.")
    city: str | None = Field(None, description="City where the entity is based.")
    state: str | None = Field(None, description="2-letter state code.")
    geo_specificity: GeoSpecificity = Field(
        default=GeoSpecificity.LOCAL,
        description="Geographic scope of the entity.",
    )
    issue_areas: list[str] = Field(
        default_factory=list,
        description="Issue area slugs this entry relates to.",
    )
    region: str | None = Field(None, description="Free-form region description.")
    website: str | None = Field(None, description="Primary website URL.")
    email: str | None = Field(None, description="Contact email address.")
    social_media: dict[str, str] = Field(
        default_factory=dict,
        description="Social media handles keyed by platform name.",
    )
    affiliated_org: str | None = Field(None, description="Name of affiliated organization.")
    extraction_context: str = Field(
        default="",
        description="Verbatim snippet from the source that mentioned this entity.",
    )
    source_url: str = Field(default="", description="URL the entry was extracted from.")
    source_date: date | None = Field(None, description="Publication date of the source page.")
    mentioned_entities: list[dict[str, str]] = Field(
        default_factory=list,
        description="Other entities mentioned in the same source (name, type, relationship).",
    )
    discovery_leads: list[str] = Field(
        default_factory=list,
        description="URLs or entity names worth following up for further discovery.",
    )


class DeduplicatedEntry(BaseModel):
    """An entry that has been deduplicated across multiple sources."""

    name: str = Field(..., description="Canonical name of the entity.")
    entry_type: EntityType = Field(..., description="Entity type.")
    description: str = Field(default="", description="Best available description.")
    city: str | None = Field(None, description="City where the entity is based.")
    state: str | None = Field(None, description="2-letter state code.")
    geo_specificity: GeoSpecificity = Field(
        default=GeoSpecificity.LOCAL,
        description="Geographic scope of the entity.",
    )
    issue_areas: list[str] = Field(
        default_factory=list,
        description="Issue area slugs this entry relates to.",
    )
    region: str | None = Field(None, description="Free-form region description.")
    website: str | None = Field(None, description="Primary website URL.")
    email: str | None = Field(None, description="Contact email address.")
    social_media: dict[str, str] = Field(
        default_factory=dict,
        description="Social media handles keyed by platform name.",
    )
    affiliated_org: str | None = Field(None, description="Name of affiliated organization.")
    source_urls: list[str] = Field(
        default_factory=list,
        description="All source URLs where this entity was mentioned.",
    )
    source_dates: list[date] = Field(
        default_factory=list,
        description="Publication dates corresponding to each source URL.",
    )
    source_contexts: dict[str, str] = Field(
        default_factory=dict,
        description="Extraction context snippets keyed by source URL.",
    )
    last_seen: date | None = Field(None, description="Most recent date this entity was observed.")


class RankedEntry(BaseModel):
    """A deduplicated entry with a relevance score and score components."""

    entry: DeduplicatedEntry = Field(..., description="The underlying deduplicated entry.")
    score: float = Field(..., description="Composite relevance score (higher is better).")
    components: dict[str, Any] = Field(
        default_factory=dict,
        description="Individual scoring component values.",
    )


class DiscoveryRunInput(BaseModel):
    """Canonical input definition for a discovery run."""

    location_query: str = Field(
        ...,
        description="Location query (for example, 'Kansas City, MO').",
        min_length=1,
    )
    state: str = Field(..., description="2-letter state code.", min_length=2, max_length=2)
    issue_areas: list[str] = Field(
        ...,
        description="Issue area slugs that define the run.",
        min_length=1,
    )
    search_depth: str = Field(
        default="standard",
        description="Discovery depth hint used by the runner.",
    )


class DiscoveryRunStats(BaseModel):
    """Canonical run statistics captured by local runners and Atlas service."""

    queries_generated: int = Field(default=0, ge=0)
    sources_fetched: int = Field(default=0, ge=0)
    sources_processed: int = Field(default=0, ge=0)
    entries_extracted: int = Field(default=0, ge=0)
    entries_after_dedup: int = Field(default=0, ge=0)
    entries_confirmed: int = Field(default=0, ge=0)
    status: DiscoveryRunStatus = Field(
        default=DiscoveryRunStatus.COMPLETED,
        description="Final status reported for the run payload.",
    )
    error_message: str | None = Field(None, description="Failure reason when the run did not complete.")


class RunCheckpoint(BaseModel):
    """A durable checkpoint emitted during discovery execution."""

    phase: str = Field(..., description="Execution phase name.")
    status: DiscoveryRunStatus = Field(..., description="Run status at this checkpoint.")
    message: str | None = Field(None, description="Optional human-readable checkpoint detail.")
    metrics: dict[str, Any] = Field(
        default_factory=dict,
        description="Structured metrics snapshot captured at the checkpoint.",
    )
    created_at: datetime | None = Field(None, description="Checkpoint creation time.")


class PageTaskOutcome(BaseModel):
    """Canonical outcome for one fetched or attempted page."""

    task_id: str = Field(..., description="Stable page-task identifier.")
    url: str = Field(..., description="Page URL.")
    status: str = Field(..., description="Final page-task status.")
    depth: int = Field(default=0, ge=0, description="Crawl depth for the page.")
    seed_url: str | None = Field(None, description="Seed URL that caused the page to be scheduled.")
    discovered_from: str | None = Field(
        None,
        description="Parent page URL that discovered this page, when applicable.",
    )
    entries_extracted: int = Field(default=0, ge=0, description="Number of entries extracted.")
    error: str | None = Field(None, description="Failure or skip reason.")
    user_visible: bool = Field(
        default=False,
        description="Whether this page outcome should be shown in user-facing inspection.",
    )


class DiscoverySyncInfo(BaseModel):
    """Sync and reconciliation metadata for a local or remotely replayed run."""

    local_run_id: str | None = Field(None, description="Runner-local run identifier.")
    remote_run_id: str | None = Field(None, description="Atlas run identifier created during sync.")
    sync_status: str | None = Field(None, description="Current sync status for the run bundle.")
    artifact_hash: str | None = Field(None, description="Checksum or hash for the run bundle.")
    synced_at: datetime | None = Field(None, description="Most recent successful sync time.")
    last_error: str | None = Field(None, description="Most recent sync failure message.")


class DiscoveryRunManifest(BaseModel):
    """Canonical manifest describing one discovery execution."""

    runner: str = Field(..., description="Runner identity, for example 'atlas-api' or 'atlas-scout'.")
    run: DiscoveryRunInput = Field(..., description="Run targeting inputs.")
    status: DiscoveryRunStatus = Field(..., description="Current overall run status.")
    started_at: datetime | None = Field(None, description="Run start time.")
    completed_at: datetime | None = Field(None, description="Run completion time.")
    sync: DiscoverySyncInfo | None = Field(None, description="Optional remote-sync metadata.")


class DiscoveryRunArtifacts(BaseModel):
    """Portable artifact bundle for an in-progress or completed discovery run."""

    manifest: DiscoveryRunManifest = Field(..., description="Run identity and lifecycle metadata.")
    stats: DiscoveryRunStats = Field(
        default_factory=DiscoveryRunStats,
        description="Canonical run statistics.",
    )
    checkpoints: list[RunCheckpoint] = Field(
        default_factory=list,
        description="Recorded engine checkpoints for the run.",
    )
    page_tasks: list[PageTaskOutcome] = Field(
        default_factory=list,
        description="Canonical page-task outcomes.",
    )
    sources: list["PageContent"] = Field(
        default_factory=list,
        description="Fetched pages that form the source bundle.",
    )
    raw_entries: list[RawEntry] = Field(
        default_factory=list,
        description="Raw extracted entries prior to deduplication.",
    )
    ranked_entries: list[RankedEntry] = Field(
        default_factory=list,
        description="Final ranked entries for persistence or sync.",
    )
    gap_report: "GapReport | None" = Field(None, description="Optional coverage report for the run.")


class DiscoveryRunSyncRequest(BaseModel):
    """Authenticated sync payload for replaying a local run into Atlas."""

    artifacts: DiscoveryRunArtifacts = Field(
        ...,
        description="Portable run bundle emitted by Atlas Scout or another compatible runner.",
    )


class DiscoveryRunSyncResponse(BaseModel):
    """Atlas response describing the result of syncing a run bundle."""

    run_id: str = Field(..., description="Atlas discovery run identifier.")
    status: DiscoveryRunStatus = Field(..., description="Final Atlas run status after sync.")
    sync_status: str = Field(..., description="Outcome of the sync attempt.")
    entries_persisted: int = Field(..., ge=0, description="Number of entries persisted into Atlas.")
    sources_persisted: int = Field(..., ge=0, description="Number of sources persisted into Atlas.")
    duplicate: bool = Field(
        default=False,
        description="Whether this sync was treated as an idempotent replay of an existing bundle.",
    )


class DiscoveryContributionRequest(BaseModel):
    """Canonical service-ingestion payload for external discovery runners."""

    run: DiscoveryRunInput = Field(..., description="Run identity and targeting inputs.")
    stats: DiscoveryRunStats = Field(
        default_factory=DiscoveryRunStats,
        description="Execution summary from the contributing runner.",
    )
    sources: list["PageContent"] = Field(
        default_factory=list,
        description="Fetched source pages that support the contributed entries.",
    )
    ranked_entries: list[RankedEntry] = Field(
        default_factory=list,
        description="Ranked, provenance-bearing entries to ingest into Atlas.",
    )


class DiscoveryContributionResponse(BaseModel):
    """Atlas response after ingesting a contributed discovery payload."""

    run_id: str = Field(..., description="Atlas discovery run ID.")
    status: DiscoveryRunStatus = Field(..., description="Final Atlas run status.")
    entries_persisted: int = Field(..., ge=0, description="Entries persisted or updated.")
    sources_persisted: int = Field(..., ge=0, description="Distinct sources persisted or linked.")


def compute_artifact_hash(artifacts: DiscoveryRunArtifacts) -> str:
    """Return a stable checksum for a run bundle, excluding mutable sync metadata."""
    payload = artifacts.model_dump(mode="json")
    manifest_payload = payload.get("manifest")
    if isinstance(manifest_payload, dict):
        manifest_payload["sync"] = None
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return sha256(encoded.encode("utf-8")).hexdigest()


class CoverageGap(BaseModel):
    """A detected gap in issue area coverage for a location."""

    issue_area_slug: str = Field(..., description="Issue area slug with low coverage.")
    issue_area_name: str = Field(..., description="Human-readable issue area name.")
    entry_count: int = Field(default=0, description="Number of entries found for this issue area.")
    severity: float = Field(
        default=0.0,
        description="Gap severity score (0.0-1.0, higher means worse coverage).",
    )


class GapReport(BaseModel):
    """Aggregated coverage gap report for a location."""

    location: str = Field(..., description="Location query this report covers.")
    total_entries: int = Field(default=0, description="Total entries discovered.")
    covered_issues: list[str] = Field(
        default_factory=list,
        description="Issue area slugs with adequate coverage.",
    )
    missing_issues: list[str] = Field(
        default_factory=list,
        description="Issue area slugs with zero entries.",
    )
    thin_issues: list[str] = Field(
        default_factory=list,
        description="Issue area slugs with some but insufficient entries.",
    )
    uncovered_domains: list[str] = Field(
        default_factory=list,
        description="Domains with no covered issue areas.",
    )


class PageContent(BaseModel):
    """Extracted text content from a single web page."""

    url: str = Field(..., description="Source URL.")
    title: str = Field(default="", description="Page title.")
    text: str = Field(default="", description="Main extracted text content.")
    task_id: str | None = Field(None, description="Owning Scout page-task ID.")
    discovered_links: list[str] = Field(
        default_factory=list,
        description="Same-domain links discovered while fetching this page.",
    )
    publication: str | None = Field(None, description="Publication or site name.")
    published_date: datetime | None = Field(None, description="Article publication datetime.")
    source_type: SourceType = Field(
        default=SourceType.WEBSITE,
        description="Classified source type.",
    )
    structured_data: dict[str, Any] = Field(
        default_factory=dict,
        description="Structured data extracted from HTML (JSON-LD, OpenGraph, meta tags).",
    )
