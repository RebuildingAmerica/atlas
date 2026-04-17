"""
Step 5: Ranking.

Scores and ranks deduplicated entries by multiple quality dimensions.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from atlas_shared import DeduplicatedEntry, RankedEntry

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

logger = logging.getLogger(__name__)

__all__ = ["rank_entries_stream"]

# Scoring weights — must sum to 1.0
# The three vision-primary factors (source density, recency, contact surface)
# get 70% combined weight.
_W_SOURCE_DENSITY = 0.30
_W_RECENCY = 0.20
_W_CONTACT_SURFACE = 0.20
_W_GEO_SPECIFICITY = 0.10
_W_DESCRIPTION_QUALITY = 0.10
_W_ISSUE_COVERAGE = 0.10

# Normalisation divisor (raw score before capping at 1.0)
_SCORE_DIVISOR = 3.0

_GEO_SCORES: dict[str, float] = {
    "local": 1.0,
    "regional": 0.75,
    "statewide": 0.5,
    "national": 0.25,
}

# Recency tiers: (max_days_ago, score)
_RECENCY_TIERS: list[tuple[int, float]] = [
    (30, 1.0),
    (90, 0.75),
    (180, 0.5),
    (365, 0.25),
]
_RECENCY_OLD = 0.1


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
        Minimum score threshold (0.0-1.0); entries below this are dropped.

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
    recency = _score_recency(entry)
    geo_specificity = _GEO_SCORES.get(str(entry.geo_specificity), 0.0)
    contact_surface = _score_contact_surface(entry)
    description_quality = min(len((entry.description or "").split()) / 25.0, 1.0)
    issue_coverage = min(len(entry.issue_areas) / 3.0, 1.0)

    raw_score = (
        source_density * _W_SOURCE_DENSITY
        + recency * _W_RECENCY
        + geo_specificity * _W_GEO_SPECIFICITY
        + contact_surface * _W_CONTACT_SURFACE
        + description_quality * _W_DESCRIPTION_QUALITY
        + issue_coverage * _W_ISSUE_COVERAGE
    )

    score = min(raw_score / _SCORE_DIVISOR, 1.0)

    components = {
        "source_density": source_density,
        "recency": recency,
        "geo_specificity": geo_specificity,
        "contact_surface": contact_surface,
        "description_quality": description_quality,
        "issue_coverage": issue_coverage,
    }

    return RankedEntry(entry=entry, score=score, components=components)


def _score_recency(entry: DeduplicatedEntry) -> float:
    """Score recency from last_seen or most recent source_date."""
    most_recent = entry.last_seen
    if most_recent is None and entry.source_dates:
        most_recent = max(entry.source_dates)
    if most_recent is None:
        return 0.0

    days_ago = (datetime.now(UTC).date() - most_recent).days
    if days_ago < 0:
        return 1.0
    for max_days, tier_score in _RECENCY_TIERS:
        if days_ago <= max_days:
            return tier_score
    return _RECENCY_OLD


def _score_contact_surface(entry: DeduplicatedEntry) -> float:
    """Score contact surface completeness: website, email, social media."""
    score = 0.0
    if entry.website:
        score += 0.4
    if entry.email:
        score += 0.35
    if entry.social_media:
        score += 0.25
    return min(score, 1.0)
