"""API adapter around the shared discovery-engine deduplication logic."""

from typing import Any

from atlas_discovery_engine import DeduplicationFlag, DedupResult, deduplicate_entry_dicts

__all__ = ["DedupResult", "DeduplicationFlag", "deduplicate_entries"]


def deduplicate_entries(
    extracted: list[dict[str, Any]],
    existing: list[dict[str, Any]] | None = None,
) -> DedupResult:
    """Deduplicate API record dictionaries using the shared engine."""
    return deduplicate_entry_dicts(extracted, existing)
