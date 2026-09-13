"""Shared discovery execution primitives for Atlas and Scout."""

from atlas_discovery_engine.coverage import CoverageSummary, summarize_issue_counts
from atlas_discovery_engine.dedup import (
    DeduplicationFlag,
    DedupResult,
    deduplicate_entry_dicts,
    deduplicate_raw_entries_stream,
)
from atlas_discovery_engine.extraction import (
    ExtractionFailedError,
    StructuredExtractionItem,
    StructuredExtractionResponse,
    build_extraction_system_prompt,
    build_identify_system_prompt,
    normalize_entity_type,
    normalize_geo_specificity,
    parse_extraction_response,
    parse_identify_response,
    strip_code_fence,
    validate_entries,
)
from atlas_discovery_engine.filings import (
    FilingOfficer,
    FilingOfficerProvider,
    IrsFilingOfficerProvider,
    OrganizationFiling,
    parse_officers,
)
from atlas_discovery_engine.querying import (
    SearchQuery,
    generate_queries,
    generate_queries_stream,
    sample_queries_across_categories,
)
from atlas_discovery_engine.registry import (
    ATLAS_USER_AGENT,
    ProPublicaRegistryProvider,
    RegistryOrganization,
    RegistryProvider,
    registry_terms_for_issue,
)
from atlas_discovery_engine.scoring import (
    ScoredRecord,
    score_ranked_records,
    score_ranked_stream,
)
from atlas_discovery_engine.search import (
    BraveSearchProvider,
    FallbackSearchProvider,
    SearchProvider,
    SearchResult,
    StaticSearchProvider,
)

__all__ = [
    "ATLAS_USER_AGENT",
    "BraveSearchProvider",
    "CoverageSummary",
    "DedupResult",
    "DeduplicationFlag",
    "ExtractionFailedError",
    "FallbackSearchProvider",
    "FilingOfficer",
    "FilingOfficerProvider",
    "IrsFilingOfficerProvider",
    "OrganizationFiling",
    "ProPublicaRegistryProvider",
    "RegistryOrganization",
    "RegistryProvider",
    "ScoredRecord",
    "SearchProvider",
    "SearchQuery",
    "SearchResult",
    "StaticSearchProvider",
    "StructuredExtractionItem",
    "StructuredExtractionResponse",
    "build_extraction_system_prompt",
    "build_identify_system_prompt",
    "deduplicate_entry_dicts",
    "deduplicate_raw_entries_stream",
    "generate_queries",
    "generate_queries_stream",
    "normalize_entity_type",
    "normalize_geo_specificity",
    "parse_extraction_response",
    "parse_identify_response",
    "parse_officers",
    "registry_terms_for_issue",
    "sample_queries_across_categories",
    "score_ranked_records",
    "score_ranked_stream",
    "strip_code_fence",
    "summarize_issue_counts",
    "validate_entries",
]
