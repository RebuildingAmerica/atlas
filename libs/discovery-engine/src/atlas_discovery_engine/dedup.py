"""Shared deduplication primitives."""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import TYPE_CHECKING, Any

from atlas_shared import DeduplicatedEntry, RawEntry

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

__all__ = [
    "DedupResult",
    "DeduplicationFlag",
    "deduplicate_entry_dicts",
    "deduplicate_raw_entries_stream",
]

_HIGH_SIMILARITY_THRESHOLD = 0.9


@dataclass(frozen=True)
class DeduplicationFlag:
    """A potential duplicate pair that should be reviewed."""

    entry_indices: list[int]
    confidence: float
    reason: str


@dataclass(frozen=True)
class DedupResult:
    """Deduplicated record output with merge bookkeeping."""

    entries: list[dict[str, Any]]
    merges: list[list[int]]
    flags: list[DeduplicationFlag]


def deduplicate_entry_dicts(
    extracted: list[dict[str, Any]],
    existing: list[dict[str, Any]] | None = None,
) -> DedupResult:
    """Deduplicate extracted dictionaries against each other and optional existing records."""
    combined = [_normalized_dict(entry) for entry in extracted]
    merges: list[list[int]] = []
    flags: list[DeduplicationFlag] = []
    kept_indices: list[int] = []

    if existing:
        for entry in existing:
            baseline = _normalized_dict(entry)
            baseline["_existing"] = True
            combined.append(baseline)

    for idx, entry in enumerate(combined):
        matched_index: int | None = None
        for kept_index in kept_indices:
            kept_entry = combined[kept_index]
            match_type = _match_type(
                name_left=str(kept_entry.get("name", "")),
                name_right=str(entry.get("name", "")),
                city_left=_optional_str(kept_entry.get("city")),
                city_right=_optional_str(entry.get("city")),
                entry_type_left=_optional_str(kept_entry.get("entry_type")),
                entry_type_right=_optional_str(entry.get("entry_type")),
                affiliated_org_left=_optional_str(kept_entry.get("affiliated_org")),
                affiliated_org_right=_optional_str(entry.get("affiliated_org")),
            )
            if match_type == "merge":
                combined[kept_index] = _merge_entry_dicts(kept_entry, entry)
                matched_index = kept_index
                merges.append([kept_index, idx])
                break
            if match_type == "flag":
                flags.append(
                    DeduplicationFlag(
                        entry_indices=[kept_index, idx],
                        confidence=_similarity_ratio(
                            str(kept_entry.get("name", "")),
                            str(entry.get("name", "")),
                        ),
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


async def deduplicate_raw_entries_stream(
    entries: AsyncIterator[RawEntry],
    batch_size: int = 50,
) -> AsyncIterator[DeduplicatedEntry]:
    """Deduplicate a stream of raw entries into canonical shared entries."""
    canonical: list[DeduplicatedEntry] = []
    batch: list[RawEntry] = []

    async def _flush(items: list[RawEntry]) -> None:
        for raw in items:
            dedup = _raw_to_dedup(raw)
            matched_index = _find_shared_match(dedup, canonical)
            if matched_index is not None:
                canonical[matched_index] = _merge_shared_entries(canonical[matched_index], dedup)
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
    source_urls = [raw.source_url] if raw.source_url else []
    source_contexts = {raw.source_url: raw.extraction_context} if raw.source_url else {}
    source_dates = [raw.source_date] if raw.source_date else []
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
        source_dates=source_dates,
        source_contexts=source_contexts,
        last_seen=raw.source_date,
    )


def _find_shared_match(entry: DeduplicatedEntry, canonical: list[DeduplicatedEntry]) -> int | None:
    for idx, existing in enumerate(canonical):
        if _match_type(
            name_left=existing.name,
            name_right=entry.name,
            city_left=existing.city,
            city_right=entry.city,
            entry_type_left=str(existing.entry_type),
            entry_type_right=str(entry.entry_type),
            affiliated_org_left=existing.affiliated_org,
            affiliated_org_right=entry.affiliated_org,
        ) == "merge":
            return idx
    return None


def _merge_shared_entries(left: DeduplicatedEntry, right: DeduplicatedEntry) -> DeduplicatedEntry:
    descriptions = [value for value in [left.description, right.description] if value]
    best_description = max(descriptions, key=len) if descriptions else ""
    combined_dates = sorted(set(left.source_dates) | set(right.source_dates))
    return DeduplicatedEntry(
        name=left.name,
        entry_type=left.entry_type,
        description=best_description,
        city=left.city,
        state=left.state or right.state,
        geo_specificity=left.geo_specificity,
        issue_areas=sorted(set(left.issue_areas) | set(right.issue_areas)),
        region=left.region or right.region,
        website=left.website or right.website,
        email=left.email or right.email,
        social_media={**left.social_media, **right.social_media},
        affiliated_org=left.affiliated_org or right.affiliated_org,
        source_urls=sorted(set(left.source_urls) | set(right.source_urls)),
        source_dates=combined_dates,
        source_contexts={**left.source_contexts, **right.source_contexts},
        last_seen=max(combined_dates) if combined_dates else left.last_seen or right.last_seen,
    )


def _merge_entry_dicts(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    merged = dict(left)
    descriptions = [value for value in [left.get("description"), right.get("description")] if value]
    merged["description"] = max(descriptions, key=len) if descriptions else ""
    merged["issue_areas"] = sorted(
        set(_list_of_str(left.get("issue_areas"))) | set(_list_of_str(right.get("issue_areas")))
    )
    merged["source_urls"] = sorted(
        set(_list_of_str(left.get("source_urls"))) | set(_list_of_str(right.get("source_urls")))
    )
    merged_dates = list(
        dict.fromkeys([*(_list_any(left.get("source_dates"))), *(_list_any(right.get("source_dates")))])
    )
    merged["source_dates"] = merged_dates
    merged["last_seen"] = _max_date_like(
        [*merged_dates, left.get("last_seen"), right.get("last_seen")]
    )

    source_contexts = dict(_dict_str(left.get("source_contexts")))
    source_contexts.update(_dict_str(right.get("source_contexts")))
    if source_contexts:
        merged["source_contexts"] = source_contexts

    for key in ["website", "email", "region", "phone", "affiliated_org", "affiliated_org_id"]:
        if not merged.get(key) and right.get(key):
            merged[key] = right[key]

    merged_social = {
        **_dict_str(left.get("social_media")),
        **_dict_str(right.get("social_media")),
    }
    merged["social_media"] = merged_social or None
    return merged


def _match_type(
    *,
    name_left: str,
    name_right: str,
    city_left: str | None,
    city_right: str | None,
    entry_type_left: str | None,
    entry_type_right: str | None,
    affiliated_org_left: str | None,
    affiliated_org_right: str | None,
) -> str | None:
    same_city = city_left == city_right
    same_type = entry_type_left == entry_type_right
    same_person_type = entry_type_left == "person" and entry_type_right == "person"
    same_organization_type = entry_type_left == "organization" and entry_type_right == "organization"
    exact_name = name_left.strip().lower() == name_right.strip().lower()
    affiliated_match = (
        affiliated_org_left
        and affiliated_org_right
        and affiliated_org_left.strip().lower() == affiliated_org_right.strip().lower()
    )
    similarity = _similarity_ratio(name_left, name_right)
    high_similarity_same_city = same_city and similarity >= _HIGH_SIMILARITY_THRESHOLD

    if exact_name and same_city and same_type:
        return "merge"
    if same_organization_type and exact_name:
        return "merge" if same_city or len(name_left.split()) == 1 else "flag"
    if same_person_type and affiliated_match and exact_name:
        return "merge"
    if (
        (same_person_type and affiliated_match and high_similarity_same_city)
        or high_similarity_same_city
        or (exact_name and not same_city)
    ):
        return "flag"
    return None


def _similarity_ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _optional_str(value: Any) -> str | None:
    return str(value) if value is not None else None


def _normalized_dict(entry: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(entry)
    normalized["issue_areas"] = _list_of_str(normalized.get("issue_areas"))
    normalized["source_urls"] = _list_of_str(normalized.get("source_urls"))
    normalized["source_dates"] = _list_any(normalized.get("source_dates"))
    normalized["source_contexts"] = _dict_str(normalized.get("source_contexts"))
    social_media = _dict_str(normalized.get("social_media"))
    normalized["social_media"] = social_media or None
    return normalized


def _list_of_str(value: Any) -> list[str]:
    if not value:
        return []
    return [str(item) for item in value]


def _list_any(value: Any) -> list[Any]:
    if not value:
        return []
    return list(value)


def _dict_str(value: Any) -> dict[str, str]:
    if not value:
        return {}
    return {str(key): str(item) for key, item in dict(value).items()}


def _max_date_like(values: list[Any]) -> Any:
    comparable = [str(value) for value in values if value]
    return max(comparable) if comparable else None
