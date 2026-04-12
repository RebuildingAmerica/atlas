"""
Step 5: Ranking.

Scores and ranks deduplicated entries by multiple quality dimensions.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from atlas_shared import DeduplicatedEntry, RankedEntry

logger = logging.getLogger(__name__)

__all__ = ["rank_entries_stream"]

# Scoring weights — must sum to 1.0
_W_SOURCE_DENSITY = 0.35
_W_GEO_SPECIFICITY = 0.15
_W_CONTACT_SURFACE = 0.20
_W_DESCRIPTION_QUALITY = 0.15
_W_ISSUE_COVERAGE = 0.15

# Normalisation divisor (raw score before capping at 1.0)
_SCORE_DIVISOR = 3.0

_GEO_SCORES: dict[str, float] = {
    "local": 1.0,
    "regional": 0.75,
    "statewide": 0.5,
    "national": 0.25,
}


async def rank_entries_stream(
    entries: AsyncIterator[DeduplicatedEntry],
    min_score: float = 0.0,
) -> AsyncIterator[RankedEntry]:
    """
    Score and rank entries, yielding them in descending score order.

    Collects all entries, computes scores, filters below ``min_score``,
    and yields from highest to lowest score.

    Parameters
    ----------
    entries : AsyncIterator[DeduplicatedEntry]
        Deduplicated entries to rank.
    min_score : float
        Minimum score threshold (0.0–1.0); entries below this are dropped.

    Yields
    ------
    RankedEntry
        Scored entries in descending order.
    """
    entry_list = [e async for e in entries]
    ranked = [_score_entry(e) for e in entry_list]
    ranked = [r for r in ranked if r.score >= min_score]
    ranked.sort(key=lambda r: r.score, reverse=True)

    for entry in ranked:
        yield entry


def _score_entry(entry: DeduplicatedEntry) -> RankedEntry:
    """Compute a composite relevance score for a single entry."""
    source_density = min(len(entry.source_urls), 5.0)
    geo_specificity = _GEO_SCORES.get(str(entry.geo_specificity), 0.0)
    contact_surface = (
        1.0
        if entry.website and entry.email
        else (0.6 if entry.website else 0.0)
    )
    description_quality = min(len((entry.description or "").split()) / 25.0, 1.0)
    issue_coverage = min(len(entry.issue_areas) / 3.0, 1.0)

    raw_score = (
        source_density * _W_SOURCE_DENSITY
        + geo_specificity * _W_GEO_SPECIFICITY
        + contact_surface * _W_CONTACT_SURFACE
        + description_quality * _W_DESCRIPTION_QUALITY
        + issue_coverage * _W_ISSUE_COVERAGE
    )

    score = min(raw_score / _SCORE_DIVISOR, 1.0)

    components = {
        "source_density": source_density,
        "geo_specificity": geo_specificity,
        "contact_surface": contact_surface,
        "description_quality": description_quality,
        "issue_coverage": issue_coverage,
    }

    return RankedEntry(entry=entry, score=score, components=components)
