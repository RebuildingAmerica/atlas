"""
atlas-shared: shared types and taxonomy for the Atlas ecosystem.

Re-exports all public types from the sub-modules so consumers can import
directly from `atlas_shared`.
"""

from atlas_shared.schemas import (
    CoverageGap,
    DeduplicatedEntry,
    GapReport,
    PageContent,
    RankedEntry,
    RawEntry,
)
from atlas_shared.taxonomy import (
    ALL_ISSUE_SLUGS,
    DOMAINS,
    ISSUE_AREAS_BY_DOMAIN,
    ISSUE_SEARCH_TERMS,
    IssueArea,
    get_issue_area_by_slug,
    get_issues_by_domain,
)
from atlas_shared.types import EntityType, GeoSpecificity, SourceType

__all__ = [
    # schemas
    "CoverageGap",
    "DeduplicatedEntry",
    "GapReport",
    "PageContent",
    "RankedEntry",
    "RawEntry",
    # taxonomy
    "ALL_ISSUE_SLUGS",
    "DOMAINS",
    "ISSUE_AREAS_BY_DOMAIN",
    "ISSUE_SEARCH_TERMS",
    "IssueArea",
    "get_issue_area_by_slug",
    "get_issues_by_domain",
    # types
    "EntityType",
    "GeoSpecificity",
    "SourceType",
]
