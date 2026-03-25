"""
Step 5: Ranking.

Ranks entries by source density, recency, geo specificity, contact surface,
and description quality.
"""

from dataclasses import dataclass
from typing import Any

__all__ = ["RankedEntry", "rank_entries"]


@dataclass
class RankedEntry:
    """An entry with a ranking score."""

    entry: dict[str, Any]
    """The entry data."""

    score: float
    """Ranking score (higher is better)."""

    components: dict[str, float]
    """Component scores (source_density, recency, etc.)."""


def rank_entries(
    entries: list[dict[str, Any]],
    source_counts: dict[str, int] | None = None,
) -> list[RankedEntry]:
    """
    Rank entries by multiple criteria.

    Parameters
    ----------
    entries : list[dict[str, Any]]
        Entries to rank.
    source_counts : dict[str, int] | None, optional
        Entry ID → number of sources. Default is None.

    Returns
    -------
    list[RankedEntry]
        Entries ranked with scores.

    Notes
    -----
    Ranking criteria (weighted):
    1. Source density (highest): distinct source count
    2. Recency: most recent source date
    3. Geographic specificity: local > regional > statewide > national
    4. Contact surface: website + email > website > nothing
    5. Description quality: detailed > generic
    """
    # Stub implementation returns unranked entries
    if source_counts is None:
        source_counts = {}

    ranked = [
        RankedEntry(
            entry=entry,
            score=0.0,
            components={},
        )
        for entry in entries
    ]

    return sorted(ranked, key=lambda x: x.score, reverse=True)
