"""Shared discovery execution primitives for Atlas and Scout."""

from atlas_discovery_engine.coverage import CoverageSummary, summarize_issue_counts
from atlas_discovery_engine.dedup import (
    DeduplicationFlag,
    DedupResult,
    deduplicate_entry_dicts,
    deduplicate_raw_entries_stream,
)
from atlas_discovery_engine.querying import SearchQuery, generate_queries, generate_queries_stream
from atlas_discovery_engine.scoring import (
    ScoredRecord,
    score_ranked_records,
    score_ranked_stream,
)

__all__ = [
    "CoverageSummary",
    "DedupResult",
    "DeduplicationFlag",
    "ScoredRecord",
    "SearchQuery",
    "deduplicate_entry_dicts",
    "deduplicate_raw_entries_stream",
    "generate_queries",
    "generate_queries_stream",
    "score_ranked_records",
    "score_ranked_stream",
    "summarize_issue_counts",
]
