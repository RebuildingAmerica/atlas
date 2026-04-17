"""
Step 4: Deduplication.

Merges duplicate entries and flags conflicts for manual review.

Uses a matching strategy based on name similarity, type, city, and
affiliated organization.
"""

from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

__all__ = ["DedupResult", "DeduplicationFlag", "deduplicate_entries"]

_SIMILARITY_THRESHOLD = 0.9


@dataclass
class DeduplicationFlag:
    """A flagged match that needs manual review."""

    entry_indices: list[int]
    """Indices of potentially duplicate entries."""

    confidence: float
    """Confidence score (0-1)."""

    reason: str
    """Why these entries might be duplicates."""


@dataclass
class DedupResult:
    """Result of deduplication."""

    entries: list[dict[str, Any]]
    """Deduplicated entries."""

    merges: list[list[int]]
    """Auto-merged entry indices (groups that were merged)."""

    flags: list[DeduplicationFlag]
    """Flagged matches for manual review."""


def deduplicate_entries(
    extracted: list[dict[str, Any]],
    existing: list[dict[str, Any]] | None = None,
) -> DedupResult:
    """
    Deduplicate entries from extraction.

    Parameters
    ----------
    extracted : list[dict[str, Any]]
        Entries extracted from this pipeline run.
    _existing : list[dict[str, Any]] | None, optional
        Existing entries in the database. Default is None.

    Returns
    -------
    DedupResult
        Deduplication result with merged and flagged entries.

    Notes
    -----
    Matching strategy (in order of confidence):
    1. Exact name + same city + same type → auto-merge
    2. Exact org name match → auto-merge
    3. Person name + same affiliated org → auto-merge
    4. Fuzzy name + same city → flag for manual review
    5. Same name + different city → flag for manual review
    """
    combined = [dict(entry) for entry in extracted]
    merges: list[list[int]] = []
    flags: list[DeduplicationFlag] = []
    kept_indices: list[int] = []

    if existing:
        for entry in existing:
            baseline = dict(entry)
            baseline["_existing"] = True
            combined.append(baseline)

    for idx, entry in enumerate(combined):
        matched_index: int | None = None

        for kept_index in kept_indices:
            kept_entry = combined[kept_index]
            match_type = _match_type(kept_entry, entry)
            if match_type == "merge":
                combined[kept_index] = _merge_entries(kept_entry, entry)
                matched_index = kept_index
                merges.append([kept_index, idx])
                break
            if match_type == "flag":
                flags.append(
                    DeduplicationFlag(
                        entry_indices=[kept_index, idx],
                        confidence=_similarity_ratio(kept_entry["name"], entry["name"]),
                        reason="similar_name_same_city",
                    )
                )

        if matched_index is None:
            kept_indices.append(idx)

    deduped_entries = [
        {key: value for key, value in combined[idx].items() if not key.startswith("_")}
        for idx in kept_indices
    ]

    return DedupResult(entries=deduped_entries, merges=merges, flags=flags)


def _similarity_ratio(a: str, b: str) -> float:
    """
    Calculate similarity between two strings (0-1).

    Parameters
    ----------
    a : str
        First string.
    b : str
        Second string.

    Returns
    -------
    float
        Similarity ratio.
    """
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _match_type(left: dict[str, Any], right: dict[str, Any]) -> str | None:  # noqa: PLR0911
    """Determine whether two entries should merge or be flagged."""
    same_city = left.get("city") == right.get("city")
    same_type = left.get("entry_type") == right.get("entry_type")
    exact_name = left.get("name", "").strip().lower() == right.get("name", "").strip().lower()
    affiliated_match = (
        left.get("affiliated_org")
        and right.get("affiliated_org")
        and left["affiliated_org"].strip().lower() == right["affiliated_org"].strip().lower()
    )
    similarity = _similarity_ratio(left.get("name", ""), right.get("name", ""))

    if exact_name and same_city and same_type:
        return "merge"
    if (
        left.get("entry_type") == "organization"
        and right.get("entry_type") == "organization"
        and exact_name
    ):
        return "merge"
    if (
        left.get("entry_type") == "person"
        and right.get("entry_type") == "person"
        and affiliated_match
    ):
        if exact_name:
            return "merge"
        if same_city and similarity >= _SIMILARITY_THRESHOLD:
            return "flag"
    if same_city and similarity >= _SIMILARITY_THRESHOLD:
        return "flag"
    if exact_name and left.get("city") != right.get("city"):
        return "flag"
    return None


def _merge_entries(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    """Combine two matching entry dictionaries into one richer record."""
    merged = dict(left)
    merged["description"] = max(
        [value for value in [left.get("description"), right.get("description")] if value],
        key=len,
    )
    merged["issue_areas"] = sorted(
        set(left.get("issue_areas", [])) | set(right.get("issue_areas", []))
    )
    merged["source_urls"] = sorted(
        set(left.get("source_urls", [])) | set(right.get("source_urls", []))
    )
    merged["source_dates"] = sorted(
        set(left.get("source_dates", [])) | set(right.get("source_dates", []))
    )
    merged["last_seen"] = max(
        merged["source_dates"], default=left.get("last_seen") or right.get("last_seen")
    )

    source_contexts = dict(left.get("source_contexts", {}))
    source_contexts.update(right.get("source_contexts", {}))
    if source_contexts:
        merged["source_contexts"] = source_contexts

    for key in ["website", "email", "region", "phone", "affiliated_org", "affiliated_org_id"]:
        if not merged.get(key) and right.get(key):
            merged[key] = right[key]

    left_social = left.get("social_media") or {}
    right_social = right.get("social_media") or {}
    merged_social = {**left_social, **right_social}
    merged["social_media"] = merged_social or None

    return merged
