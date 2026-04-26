"""Scout adapter around the shared discovery-engine query generation."""

from atlas_discovery_engine import SearchQuery, generate_queries, generate_queries_stream

__all__ = ["SearchQuery", "generate_queries", "generate_queries_stream"]
