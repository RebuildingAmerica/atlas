"""
atlas-shared: shared types and taxonomy for the Atlas ecosystem.

Re-exports all public types from the sub-modules so consumers can import
directly from `atlas_shared`.
"""

from atlas_shared.schemas import (
    CoverageGap,
    DiscoveryContributionRequest,
    DiscoveryContributionResponse,
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoveryRunSyncRequest,
    DiscoveryRunSyncResponse,
    DiscoveryRunStats,
    DiscoverySyncInfo,
    compute_artifact_hash,
    DeduplicatedEntry,
    GapReport,
    PageContent,
    PageTaskOutcome,
    RankedEntry,
    RawEntry,
    RunCheckpoint,
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
from atlas_shared.types import DiscoveryRunStatus, EntityType, GeoSpecificity, SourceType

__all__ = [
    # schemas
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
    # taxonomy
    "ALL_ISSUE_SLUGS",
    "DOMAINS",
    "ISSUE_AREAS_BY_DOMAIN",
    "ISSUE_SEARCH_TERMS",
    "IssueArea",
    "get_issue_area_by_slug",
    "get_issues_by_domain",
    # types
    "DiscoveryRunStatus",
    "EntityType",
    "GeoSpecificity",
    "SourceType",
]
