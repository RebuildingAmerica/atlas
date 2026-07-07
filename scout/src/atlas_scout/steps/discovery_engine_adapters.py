"""Scout adapters around the shared discovery-engine dedup and ranking logic."""

from atlas_discovery_engine import deduplicate_raw_entries_stream as deduplicate_stream
from atlas_discovery_engine import score_ranked_stream as rank_entries_stream

__all__ = ["deduplicate_stream", "rank_entries_stream"]
