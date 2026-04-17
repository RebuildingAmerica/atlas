"""
Shared Pydantic schemas for the Atlas pipeline and API.

These models represent the data structures passed between pipeline stages
and stored in the local SQLite store.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field

from atlas_shared.types import EntityType, GeoSpecificity, SourceType

__all__ = [
    "CoverageGap",
    "DeduplicatedEntry",
    "GapReport",
    "PageContent",
    "RankedEntry",
    "RawEntry",
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
