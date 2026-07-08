"""Helper logic for the Atlas Briefing Room demo seed."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from atlas.models import EntryCRUD
from atlas.seed_briefing_room_demo_data import (
    CORROBORATED_SOURCE_THRESHOLD,
    DEMO_ARTIFACT_KIND,
    DEMO_BRIEF_TITLES,
    DEMO_LIST_NAMES,
    _DemoLane,
)

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.catalog.models.entry_model import EntryModel


@dataclass(frozen=True)
class _SourceReceipt:
    """Source data needed for the demo research summary."""

    id: str
    title: str
    url: str
    publication: str | None
    published_date: str | None
    source_type: str


@dataclass(frozen=True)
class _EntrySourceStats:
    """Source count and date summary for one seeded entry."""

    source_count: int
    latest_source_date: str | None


async def _reset_demo_artifacts(conn: aiosqlite.Connection, *, org_id: str, user_id: str) -> None:
    """Remove prior private demo artifacts while preserving public profile seed data."""
    brief_placeholders = ", ".join("?" for _ in DEMO_BRIEF_TITLES)
    await conn.execute(
        f"DELETE FROM org_briefs WHERE org_id = ? AND title IN ({brief_placeholders})",
        (org_id, *DEMO_BRIEF_TITLES),
    )
    list_placeholders = ", ".join("?" for _ in DEMO_LIST_NAMES)
    await conn.execute(
        f"DELETE FROM saved_lists WHERE user_id = ? AND name IN ({list_placeholders})",
        (user_id, *DEMO_LIST_NAMES),
    )
    cursor = await conn.execute(
        """
        SELECT run.id
        FROM discovery_runs run
        JOIN resource_ownership ownership
          ON ownership.resource_id = run.id
         AND ownership.resource_type = ?
        WHERE ownership.org_id = ?
          AND ownership.visibility = ?
          AND run.research_summary LIKE ?
        """,
        (
            "discovery_run",
            org_id,
            "private",
            f'%"artifact_kind": "{DEMO_ARTIFACT_KIND}"%',
        ),
    )
    demo_run_ids = [str(row[0]) for row in await cursor.fetchall()]
    if demo_run_ids:
        run_placeholders = ", ".join("?" for _ in demo_run_ids)
        await conn.execute(
            f"""
            DELETE FROM resource_ownership
            WHERE resource_type = ? AND resource_id IN ({run_placeholders})
            """,
            ("discovery_run", *demo_run_ids),
        )
        await conn.execute(
            f"DELETE FROM discovery_runs WHERE id IN ({run_placeholders})",
            tuple(demo_run_ids),
        )
    await conn.commit()


async def _get_required_entry(conn: aiosqlite.Connection, slug: str) -> EntryModel:
    """Load a seeded profile by slug or fail loudly."""
    entry = await EntryCRUD.get_by_slug(conn, slug)
    if entry is None:
        msg = f"Required demo profile is missing: {slug}"
        raise RuntimeError(msg)
    return entry


async def _source_receipts_for_entries(
    conn: aiosqlite.Connection, entry_ids: list[str]
) -> list[_SourceReceipt]:
    """Return unique source receipts linked to the seeded demo entries."""
    placeholders = ", ".join("?" for _ in entry_ids)
    cursor = await conn.execute(
        f"""
        SELECT DISTINCT s.id, s.title, s.url, s.publication, s.published_date, s.type
        FROM sources s
        JOIN entry_sources es ON es.source_id = s.id
        WHERE es.entry_id IN ({placeholders})
        ORDER BY s.published_date DESC, s.title ASC
        """,
        tuple(entry_ids),
    )
    rows = await cursor.fetchall()
    receipts = [
        _SourceReceipt(
            id=str(row[0]),
            title=str(row[1] or "Untitled source"),
            url=str(row[2]),
            publication=str(row[3]) if row[3] is not None else None,
            published_date=str(row[4]) if row[4] is not None else None,
            source_type=str(row[5]),
        )
        for row in rows
    ]
    if not receipts:
        msg = "Required demo source receipts are missing."
        raise RuntimeError(msg)
    return receipts


async def _source_stats_for_entry(conn: aiosqlite.Connection, entry_id: str) -> _EntrySourceStats:
    """Return source count and latest source date for one entry."""
    cursor = await conn.execute(
        """
        SELECT COUNT(DISTINCT s.id), MAX(s.published_date)
        FROM sources s
        JOIN entry_sources es ON es.source_id = s.id
        WHERE es.entry_id = ?
        """,
        (entry_id,),
    )
    row = await cursor.fetchone()
    if row is None:
        return _EntrySourceStats(source_count=0, latest_source_date=None)
    return _EntrySourceStats(
        source_count=int(row[0] or 0),
        latest_source_date=str(row[1]) if row[1] is not None else None,
    )


async def _ranked_lead_payload(
    conn: aiosqlite.Connection, entry: EntryModel, lane: _DemoLane
) -> dict[str, Any]:
    """Build a ranked lead payload for the seeded research summary."""
    stats = await _source_stats_for_entry(conn, entry.id)
    why_it_matters = (
        f"{entry.name} gives the {lane.buyer_segment} lane a source-backed "
        f"{entry.type} to inspect in {lane.location_query}."
    )
    return {
        "entry_id": entry.id,
        "name": entry.name,
        "type": entry.type,
        "why_it_matters": why_it_matters,
        "source_count": stats.source_count,
        "confidence": "corroborated"
        if stats.source_count >= CORROBORATED_SOURCE_THRESHOLD
        else "partial",
        "latest_source_date": stats.latest_source_date,
    }


def _key_source_payload(source: _SourceReceipt, lane: _DemoLane) -> dict[str, Any]:
    """Build a key source payload for the seeded research summary."""
    return {
        "source_id": source.id,
        "title": source.title,
        "url": source.url,
        "publication": source.publication,
        "published_date": source.published_date,
        "why_it_matters": lane.source_reason,
    }


async def _research_summary(
    conn: aiosqlite.Connection,
    lane: _DemoLane,
    entries: list[EntryModel],
    sources: list[_SourceReceipt],
) -> dict[str, Any]:
    """Build the completed research summary used by the demo discovery run."""
    ranked_leads = [await _ranked_lead_payload(conn, entry, lane) for entry in entries]
    return {
        "artifact_kind": DEMO_ARTIFACT_KIND,
        "buyer_segment": lane.buyer_segment,
        "brief": lane.summary,
        "ranked_leads": ranked_leads,
        "key_sources": [_key_source_payload(source, lane) for source in sources],
        "gaps": list(lane.gaps),
        "reasoning_signals": list(lane.reasoning_signals),
    }


def _brief_scope(lane: _DemoLane, sources: list[_SourceReceipt]) -> dict[str, Any]:
    """Build the explicit scope stored on the seeded Atlas Brief."""
    source_types = sorted({source.source_type for source in sources})
    return {
        "actor_types": ["organization", "person"],
        "geography": lane.location_query,
        "issue_areas": list(lane.issue_areas),
        "source_types": source_types,
    }
