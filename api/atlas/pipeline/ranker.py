"""
Step 5: Ranking.

Ranks entries by source density, recency, geo specificity, contact surface,
and description quality.
"""

from datetime import date
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
    if source_counts is None:
        source_counts = {}

    ranked: list[RankedEntry] = []
    recency_values = [_days_since(entry.get("last_seen")) for entry in entries if entry.get("last_seen")]
    max_days_since = max(recency_values, default=365)

    for entry in entries:
        entry_id = entry.get("id") or entry.get("name")
        density_score = float(source_counts.get(entry_id, len(entry.get("source_urls", []))))
        recency_score = 1.0 - min(_days_since(entry.get("last_seen")), max_days_since) / max(max_days_since, 1)
        geo_score = {
            "local": 1.0,
            "regional": 0.75,
            "statewide": 0.5,
            "national": 0.25,
        }.get(entry.get("geo_specificity"), 0.0)
        contact_score = 1.0 if entry.get("website") and entry.get("email") else (0.6 if entry.get("website") else 0.0)
        description_score = min(len((entry.get("description") or "").split()) / 25.0, 1.0)
        components = {
            "source_density": density_score,
            "recency": recency_score,
            "geo_specificity": geo_score,
            "contact_surface": contact_score,
            "description_quality": description_score,
        }
        score = (
            density_score * 0.4
            + recency_score * 0.2
            + geo_score * 0.15
            + contact_score * 0.15
            + description_score * 0.1
        )
        ranked.append(RankedEntry(entry=entry, score=score, components=components))

    return sorted(ranked, key=lambda x: x.score, reverse=True)


def _days_since(value: Any) -> int:
    """Get integer day distance from today for a date-like value."""
    if not value:
        return 365
    if isinstance(value, date):
        target = value
    else:
        target = date.fromisoformat(str(value))
    return abs((date.today() - target).days)
