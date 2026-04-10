"""
Autodiscovery pipeline for The Atlas.

A 6-step pipeline that turns location + issue areas into structured entries:
1. Query Generation: location + issues → search queries
2. Source Fetching: search queries → fetched web content
3. Extraction: web content → structured entries (via Claude)
4. Deduplication: merge duplicates and flag conflicts
5. Ranking: score entries by source density, recency, etc.
6. Gap Analysis: identify missing issue area coverage
"""

__all__ = [
    "deduplicator",
    "extractor",
    "gap_analyzer",
    "query_generator",
    "ranker",
    "runner",
    "source_fetcher",
]
