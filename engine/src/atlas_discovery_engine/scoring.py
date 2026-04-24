"""Shared ranking primitives."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Any

from atlas_shared import DeduplicatedEntry, RankedEntry

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

__all__ = ["ScoredRecord", "score_ranked_records", "score_ranked_stream"]

_W_SOURCE_DENSITY = 0.30
_W_RECENCY = 0.20
_W_CONTACT_SURFACE = 0.20
_W_GEO_SPECIFICITY = 0.10
_W_DESCRIPTION_QUALITY = 0.10
_W_ISSUE_COVERAGE = 0.10
_SCORE_DIVISOR = 3.0

_GEO_SCORES: dict[str, float] = {
    "local": 1.0,
    "regional": 0.75,
    "statewide": 0.5,
    "national": 0.25,
}

_RECENCY_TIERS: list[tuple[int, float]] = [
    (30, 1.0),
    (90, 0.75),
    (180, 0.5),
    (365, 0.25),
]
_RECENCY_OLD = 0.1


@dataclass(frozen=True)
class ScoredRecord:
    """Legacy record-shaped ranking output for Atlas API adapters."""

    entry: dict[str, Any]
    score: float
    components: dict[str, float]


def score_ranked_records(
    entries: list[dict[str, Any]],
    source_counts: dict[str, int] | None = None,
) -> list[ScoredRecord]:
    """Rank record dictionaries using the shared scoring model."""
    counts = source_counts or {}
    ranked: list[ScoredRecord] = []
    for entry in entries:
        entry_id = str(entry.get("id") or entry.get("name") or "")
        source_density = float(counts.get(entry_id, len(entry.get("source_urls", []) or [])))
        score, components = _score_values(
            source_density=min(source_density, 5.0),
            most_recent=_coerce_record_most_recent(entry),
            geo_specificity=str(entry.get("geo_specificity") or ""),
            website=_optional_str(entry.get("website")),
            email=_optional_str(entry.get("email")),
            social_media=_dict_len(entry.get("social_media")),
            description=_optional_str(entry.get("description")) or "",
            issue_areas_count=len(entry.get("issue_areas") or []),
        )
        ranked.append(ScoredRecord(entry=entry, score=score, components=components))

    return sorted(ranked, key=lambda item: item.score, reverse=True)


async def score_ranked_stream(
    entries: AsyncIterator[DeduplicatedEntry],
    min_score: float = 0.0,
) -> AsyncIterator[RankedEntry]:
    """Rank shared deduplicated entries with the canonical scoring model."""
    ranked = [_score_shared_entry(entry) async for entry in entries]
    filtered = [entry for entry in ranked if entry.score >= min_score]
    filtered.sort(key=lambda item: item.score, reverse=True)
    for entry in filtered:
        yield entry


def _score_shared_entry(entry: DeduplicatedEntry) -> RankedEntry:
    score, components = _score_values(
        source_density=min(float(len(entry.source_urls)), 5.0),
        most_recent=entry.last_seen or (max(entry.source_dates) if entry.source_dates else None),
        geo_specificity=str(entry.geo_specificity),
        website=entry.website,
        email=entry.email,
        social_media=len(entry.social_media),
        description=entry.description,
        issue_areas_count=len(entry.issue_areas),
    )
    return RankedEntry(entry=entry, score=score, components=components)


def _score_values(
    *,
    source_density: float,
    most_recent: date | None,
    geo_specificity: str,
    website: str | None,
    email: str | None,
    social_media: int,
    description: str,
    issue_areas_count: int,
) -> tuple[float, dict[str, float]]:
    recency = _score_recency(most_recent)
    geo_score = _GEO_SCORES.get(geo_specificity, 0.0)
    contact_surface = _score_contact_surface(website=website, email=email, social_media=social_media)
    description_quality = min(len(description.split()) / 25.0, 1.0)
    issue_coverage = min(issue_areas_count / 3.0, 1.0)

    raw_score = (
        source_density * _W_SOURCE_DENSITY
        + recency * _W_RECENCY
        + geo_score * _W_GEO_SPECIFICITY
        + contact_surface * _W_CONTACT_SURFACE
        + description_quality * _W_DESCRIPTION_QUALITY
        + issue_coverage * _W_ISSUE_COVERAGE
    )
    score = min(raw_score / _SCORE_DIVISOR, 1.0)
    components = {
        "source_density": source_density,
        "recency": recency,
        "geo_specificity": geo_score,
        "contact_surface": contact_surface,
        "description_quality": description_quality,
        "issue_coverage": issue_coverage,
    }
    return score, components


def _score_recency(most_recent: date | None) -> float:
    if most_recent is None:
        return 0.0
    days_ago = (datetime.now(UTC).date() - most_recent).days
    if days_ago < 0:
        return 1.0
    for max_days, tier_score in _RECENCY_TIERS:
        if days_ago <= max_days:
            return tier_score
    return _RECENCY_OLD


def _score_contact_surface(*, website: str | None, email: str | None, social_media: int) -> float:
    score = 0.0
    if website:
        score += 0.4
    if email:
        score += 0.35
    if social_media:
        score += 0.25
    return min(score, 1.0)


def _coerce_record_most_recent(entry: dict[str, Any]) -> date | None:
    last_seen = _coerce_date(entry.get("last_seen"))
    if last_seen is not None:
        return last_seen
    source_dates = [_coerce_date(value) for value in entry.get("source_dates", []) or []]
    valid_dates = [value for value in source_dates if value is not None]
    return max(valid_dates) if valid_dates else None


def _coerce_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


def _optional_str(value: Any) -> str | None:
    return str(value) if value is not None else None


def _dict_len(value: Any) -> int:
    if not value:
        return 0
    return len(dict(value))
