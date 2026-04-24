"""Scout adapter around the shared discovery-engine deduplication logic."""

from atlas_discovery_engine import deduplicate_raw_entries_stream as deduplicate_stream

__all__ = ["deduplicate_stream"]
