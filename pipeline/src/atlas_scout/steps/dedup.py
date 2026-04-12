"""
Step 4: Deduplication.

Streaming deduplication that merges duplicate entries as they arrive.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from difflib import SequenceMatcher

from atlas_shared import DeduplicatedEntry, RawEntry

logger = logging.getLogger(__name__)

__all__ = ["deduplicate_stream"]

_HIGH_SIMILARITY_THRESHOLD = 0.9


async def deduplicate_stream(
    entries: AsyncIterator[RawEntry],
    batch_size: int = 50,
) -> AsyncIterator[DeduplicatedEntry]:
    """
    Deduplicate a stream of raw entries by merging similar records.

    Collects entries in batches, merges duplicates within each batch and
    against already-seen canonical entries, then yields unique results.

    Merge rules:
    - Exact name + same city + same type → auto-merge
    - Similarity ≥ 0.9 + same city → auto-merge

    Parameters
    ----------
    entries : AsyncIterator[RawEntry]
        Stream of extracted entries.
    batch_size : int
        Number of incoming entries to process before flushing (default 50).

    Yields
    ------
    DeduplicatedEntry
        Deduplicated entries.
    """
    canonical: list[DeduplicatedEntry] = []

    batch: list[RawEntry] = []

    async def _flush(batch: list[RawEntry]) -> None:
        for raw in batch:
            dedup = _raw_to_dedup(raw)
            matched = _find_match(dedup, canonical)
            if matched is not None:
                canonical[matched] = _merge(canonical[matched], dedup)
            else:
                canonical.append(dedup)

    async for entry in entries:
        batch.append(entry)
        if len(batch) >= batch_size:
            await _flush(batch)
            batch = []

    if batch:
        await _flush(batch)

    for entry in canonical:
        yield entry


def _raw_to_dedup(raw: RawEntry) -> DeduplicatedEntry:
    """Convert a RawEntry to a DeduplicatedEntry."""
    source_urls = [raw.source_url] if raw.source_url else []
    source_contexts = {raw.source_url: raw.extraction_context} if raw.source_url else {}
    return DeduplicatedEntry(
        name=raw.name,
        entry_type=raw.entry_type,
        description=raw.description,
        city=raw.city,
        state=raw.state,
        geo_specificity=raw.geo_specificity,
        issue_areas=raw.issue_areas,
        region=raw.region,
        website=raw.website,
        email=raw.email,
        social_media=raw.social_media,
        affiliated_org=raw.affiliated_org,
        source_urls=source_urls,
        source_contexts=source_contexts,
    )


def _find_match(entry: DeduplicatedEntry, canonical: list[DeduplicatedEntry]) -> int | None:
    """Return index of matching canonical entry, or None if no match."""
    for idx, existing in enumerate(canonical):
        if _should_merge(existing, entry):
            return idx
    return None


def _should_merge(left: DeduplicatedEntry, right: DeduplicatedEntry) -> bool:
    """Return True if two entries should be merged."""
    same_city = left.city == right.city
    same_type = left.entry_type == right.entry_type
    exact_name = left.name.strip().lower() == right.name.strip().lower()

    if exact_name and same_city and same_type:
        return True

    similarity = SequenceMatcher(None, left.name.lower(), right.name.lower()).ratio()
    if similarity >= _HIGH_SIMILARITY_THRESHOLD and same_city:
        return True

    return False


def _merge(left: DeduplicatedEntry, right: DeduplicatedEntry) -> DeduplicatedEntry:
    """Merge two deduplicated entries into one richer record."""
    # Keep longer description
    descriptions = [d for d in [left.description, right.description] if d]
    best_description = max(descriptions, key=len) if descriptions else ""

    # Combine source_urls and source_contexts
    combined_urls = sorted(set(left.source_urls) | set(right.source_urls))
    combined_contexts = {**left.source_contexts, **right.source_contexts}

    # Combine issue_areas
    combined_issues = sorted(set(left.issue_areas) | set(right.issue_areas))

    # Fill in missing optional fields from right
    website = left.website or right.website
    email = left.email or right.email
    region = left.region or right.region
    affiliated_org = left.affiliated_org or right.affiliated_org
    state = left.state or right.state

    # Merge social media
    merged_social = {**left.social_media, **right.social_media}

    return DeduplicatedEntry(
        name=left.name,
        entry_type=left.entry_type,
        description=best_description,
        city=left.city,
        state=state,
        geo_specificity=left.geo_specificity,
        issue_areas=combined_issues,
        region=region,
        website=website,
        email=email,
        social_media=merged_social,
        affiliated_org=affiliated_org,
        source_urls=combined_urls,
        source_contexts=combined_contexts,
    )
