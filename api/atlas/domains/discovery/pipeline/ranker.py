"""API adapter around the shared discovery-engine ranking logic."""

from atlas_discovery_engine import ScoredRecord as RankedEntry
from atlas_discovery_engine import score_ranked_records as rank_entries

__all__ = ["RankedEntry", "rank_entries"]
