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
    _existing: list[dict[str, Any]] | None = None,
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
    # Stub implementation
    return DedupResult(
        entries=extracted,
        merges=[],
        flags=[],
    )


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
