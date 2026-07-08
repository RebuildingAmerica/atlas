"""Discovery pipeline storage and artifact helpers."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Any

from atlas_shared import (
    DeduplicatedEntry as SharedDeduplicatedEntry,
)
from atlas_shared import (
    PageContent,
    SourceType,
)

from atlas.domains.catalog.geo import geocode_entry
from atlas.domains.catalog.models.relationships import RelationshipCRUD
from atlas.domains.discovery.trust_gate import evaluate_publication
from atlas.domains.moderation.review_queue import ReviewQueueCRUD
from atlas.models import EntryCRUD, SourceCRUD

if TYPE_CHECKING:
    from aiosqlite import Connection

    from atlas.domains.discovery.pipeline.deduplicator import DedupResult

__all__ = [
    "_dedup_suspect_key",
    "_dedup_suspect_lookup",
    "_find_existing_entry",
    "_first_seen_for_entry",
    "_page_published_date",
    "_parse_date",
    "_persist_issue_areas",
    "_persist_sources",
    "_today_iso_date",
    "_upsert_entry",
    "evaluate_publication",
]


async def _upsert_entry(
    conn: Connection,
    entry: SharedDeduplicatedEntry,
    *,
    score: float = 0.0,
    dedup_suspect: bool = False,
    dedup_note: str | None = None,
) -> str:
    """Create or update an entry based on exact location/type/name matching."""
    city = entry.city
    state = entry.state
    match = await _find_existing_entry(conn, entry)

    if match is None:
        today_iso = _today_iso_date()
        decision = evaluate_publication(
            kind=str(entry.entry_type),
            registry_corroborated=False,
            dedup_suspect=dedup_suspect,
            score=score,
        )
        located = await geocode_entry(city, state, None, allow_remote=False)
        entity_id = str(
            await EntryCRUD.create(
                conn,
                entry_type=str(entry.entry_type),
                name=entry.name,
                description=entry.description,
                city=city,
                state=state,
                geo_specificity=str(entry.geo_specificity),
                region=entry.region,
                latitude=located.latitude if located else None,
                longitude=located.longitude if located else None,
                geocode_precision=located.precision if located else None,
                geocode_source=located.source if located else None,
                website=entry.website,
                email=entry.email,
                social_media=entry.social_media,
                first_seen=_first_seen_for_entry(entry, today_iso),
                last_seen=entry.last_seen or _parse_date(today_iso),
                active=decision.publish,
            )
        )
        if not decision.publish:
            assert decision.hold_reason is not None, "a held record always carries a hold reason"
            await ReviewQueueCRUD.enqueue(
                conn,
                entity_id=entity_id,
                kind=str(entry.entry_type),
                hold_reason=decision.hold_reason,
                score=score,
                dedup_suspect=dedup_suspect,
                dedup_note=dedup_note,
            )
        return entity_id

    today_iso = _today_iso_date()
    coordinate_fields: dict[str, Any] = {}
    if match.latitude is None or match.longitude is None:
        located = await geocode_entry(city, state, None, allow_remote=False)
        if located is not None:
            coordinate_fields = {
                "latitude": located.latitude,
                "longitude": located.longitude,
                "geocode_precision": located.precision,
                "geocode_source": located.source,
            }
    await EntryCRUD.update(
        conn,
        match.id,
        description=entry.description,
        region=entry.region,
        website=entry.website or match.website,
        email=entry.email or match.email,
        social_media=entry.social_media or match.social_media,
        last_seen=entry.last_seen or _parse_date(today_iso),
        **coordinate_fields,
    )
    return str(match.id)


async def _find_existing_entry(
    conn: Connection,
    entry: SharedDeduplicatedEntry,
) -> Any | None:
    """Find a stored actor that should absorb a repeated public mention."""
    candidates = await EntryCRUD.list(
        conn,
        state=entry.state,
        city=entry.city,
        active_only=False,
        limit=500,
    )
    exact_match = next(
        (
            candidate
            for candidate in candidates
            if candidate.type == str(entry.entry_type)
            and candidate.name.strip().lower() == entry.name.strip().lower()
        ),
        None,
    )
    if exact_match is not None:
        return exact_match

    if not entry.website:
        return None

    resolved_id = await RelationshipCRUD.resolve_identity_key(
        conn,
        key_type="domain",
        key_value=entry.website,
    )
    if resolved_id is None:
        return None

    resolved = await EntryCRUD.get_by_id(conn, resolved_id)
    if resolved is None or resolved.type != str(entry.entry_type):
        return None
    return resolved


def _dedup_suspect_key(entry: SharedDeduplicatedEntry) -> tuple[str, str | None]:
    """Build the (name, city) key used to look up dedup-suspect status."""
    return (entry.name.strip().lower(), entry.city)


def _dedup_suspect_lookup(
    deduped: DedupResult,
    extracted: list[dict[str, Any]],
    existing: list[dict[str, Any]],
) -> dict[tuple[str, str | None], str]:
    """Map dedup-flagged records to the flag reason that held them."""
    combined = [*extracted, *existing]
    suspects: dict[tuple[str, str | None], str] = {}
    for flag in deduped.flags:
        for index in flag.entry_indices:
            record = combined[index]
            name = str(record.get("name", "")).strip().lower()
            city = record.get("city")
            suspects[(name, city)] = flag.reason
    return suspects


async def _persist_issue_areas(conn: Connection, entry_id: str, issue_areas: list[str]) -> None:
    """Ensure issue area links exist for an entry."""
    for issue_area in sorted(set(issue_areas)):
        await conn.execute(
            """
            INSERT OR IGNORE INTO entry_issue_areas (entry_id, issue_area, created_at)
            VALUES (?, ?, datetime('now'))
            """,
            (entry_id, issue_area),
        )
    await conn.commit()


async def _persist_sources(
    conn: Connection,
    *,
    entry_id: str,
    entry: SharedDeduplicatedEntry,
    source_by_url: dict[str, PageContent],
) -> set[str]:
    """Create/link sources for an entry."""
    linked_source_urls: set[str] = set()
    for source_url in sorted(set(entry.source_urls)):
        source = source_by_url.get(
            source_url,
            PageContent(url=source_url, source_type=SourceType.ORG_WEBSITE),
        )
        existing = await SourceCRUD.get_by_url(conn, source_url)
        if existing is None:
            source_id = await SourceCRUD.create(
                conn,
                url=source.url,
                source_type=str(source.source_type),
                extraction_method="autodiscovery",
                title=source.title,
                publication=source.publication,
                published_date=_page_published_date(source),
                raw_content=source.text or None,
            )
        else:
            source_id = existing.id
            await SourceCRUD.update(
                conn,
                source_id,
                title=source.title or existing.title,
                publication=source.publication or existing.publication,
                published_date=_page_published_date(source) or existing.published_date,
                raw_content=source.text or existing.raw_content,
            )
        await SourceCRUD.link_to_entry(
            conn,
            entry_id,
            source_id,
            extraction_context=entry.source_contexts.get(source_url),
        )
        if entry.website:
            await RelationshipCRUD.upsert_identity_key(
                conn,
                entry_id=entry_id,
                key_type="domain",
                key_value=entry.website,
                source_id=source_id,
                confidence=0.9,
            )
        linked_source_urls.add(source_url)
    return linked_source_urls


def _parse_date(value: str) -> date:
    """Parse an ISO date string into a date."""
    return date.fromisoformat(value)


def _today_iso_date() -> str:
    """Return the current UTC calendar date as an ISO string."""
    return datetime.now(UTC).date().isoformat()


def _first_seen_for_entry(entry: SharedDeduplicatedEntry, today_iso: str) -> date:
    """Return the earliest available source date for a deduplicated entry."""
    if entry.source_dates:
        return min(entry.source_dates)
    return _parse_date(today_iso)


def _page_published_date(page: PageContent) -> date | None:
    """Convert a page timestamp to the source-table published date shape."""
    if page.published_date is None:
        return None
    return page.published_date.date()
