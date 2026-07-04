"""Seed a resettable first-customer Atlas Briefing Room demo."""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from atlas.domains.access.models.saved_lists import SavedListCRUD
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.briefs import OrgBriefCRUD
from atlas.domains.discovery.models import DiscoveryRunCRUD
from atlas.models import EntryCRUD, get_db_connection
from atlas.seed_profiles import seed_profiles

if TYPE_CHECKING:
    from collections.abc import Sequence

    import aiosqlite

    from atlas.domains.catalog.models.entry_model import EntryModel

DEMO_ORG_ID = "local"
DEMO_USER_ID = "local-operator"
DEMO_BRIEF_TITLE = "Detroit Housing Landscape Brief"
DEMO_LIST_NAME = "Detroit housing follow-up"
DEMO_LOCATION_QUERY = "Detroit, MI"
DEMO_STATE = "MI"
DEMO_ISSUE_AREAS = ("housing_affordability",)
DEMO_RESEARCH_GOAL = "landscape_scan"
DEMO_ENTRY_SLUGS = ("eastside-housing-network", "maya-thompson")
DEMO_ARTIFACT_KIND = "briefing_room_demo"
CORROBORATED_SOURCE_THRESHOLD = 2


@dataclass(frozen=True)
class DemoSeedResult:
    """IDs created by the Briefing Room demo seed."""

    org_id: str
    user_id: str
    brief_ids: list[str]
    discovery_run_ids: list[str]
    entry_ids: list[str]
    source_ids: list[str]
    saved_list_ids: list[str]
    discovery_run_id: str
    brief_id: str
    saved_list_id: str


@dataclass(frozen=True)
class _DemoLane:
    """Private demo brief lane built from the public profile seed."""

    brief_title: str
    list_name: str
    list_description: str
    location_query: str
    state: str
    issue_areas: tuple[str, ...]
    research_goal: str
    entry_slugs: tuple[str, ...]
    buyer_segment: str
    summary: str
    gaps: tuple[dict[str, str], ...]
    reasoning_signals: tuple[str, ...]
    source_reason: str


DEMO_LANES = (
    _DemoLane(
        brief_title=DEMO_BRIEF_TITLE,
        list_name=DEMO_LIST_NAME,
        list_description="Seeded follow-up list for the Detroit housing Briefing Room demo.",
        location_query=DEMO_LOCATION_QUERY,
        state=DEMO_STATE,
        issue_areas=DEMO_ISSUE_AREAS,
        research_goal=DEMO_RESEARCH_GOAL,
        entry_slugs=DEMO_ENTRY_SLUGS,
        buyer_segment="housing advocacy, funders, and nonprofit media",
        summary=(
            "Detroit housing work in the seeded demo centers on Eastside Housing Network "
            "and organizer Maya Thompson. The public profile layer gives the buyer named "
            "actors, source receipts, and visible gaps that can become a private follow-up "
            "brief instead of a loose search result."
        ),
        gaps=(
            {
                "label": "Funder relationships",
                "detail": "No source-backed funder or coalition relationship has been reviewed yet.",
            },
            {
                "label": "Current campaign calendar",
                "detail": "The demo seed does not include upcoming meeting or action dates.",
            },
        ),
        reasoning_signals=(
            "The organization and person records are linked by public sources.",
            "Multiple source receipts support the Detroit housing lane.",
            "Known gaps are preserved so the demo does not overstate coverage.",
        ),
        source_reason="This source gives the brief a public receipt for Detroit housing work.",
    ),
    _DemoLane(
        brief_title="Phoenix Worker Power Brief",
        list_name="Phoenix worker-power follow-up",
        list_description="Seeded follow-up list for the Phoenix labor Briefing Room demo.",
        location_query="Phoenix, AZ",
        state="AZ",
        issue_areas=("wage_theft_and_labor_rights", "immigration_and_belonging"),
        research_goal="partner_scan",
        entry_slugs=("sun-valley-worker-center", "luis-alvarez"),
        buyer_segment="labor organizations and worker-power funders",
        summary=(
            "Phoenix worker-power coverage centers on Sun Valley Worker Center and "
            "organizer Luis Alvarez. The lane shows how Atlas can move from public "
            "labor sources to a buyer-ready actor set for wage-theft defense, immigrant "
            "worker support, and rapid follow-up."
        ),
        gaps=(
            {
                "label": "Employer and industry map",
                "detail": "The seed does not yet connect campaigns to specific employers or sectors.",
            },
            {
                "label": "Coalition partners",
                "detail": "Legal, faith, and mutual-aid partners need a second source review.",
            },
        ),
        reasoning_signals=(
            "The worker center and organizer records share source-backed labor context.",
            "Sources show wage-theft defense and worker training as concrete program lines.",
            "The brief keeps employer and coalition gaps visible for the next pass.",
        ),
        source_reason="This source gives the brief a public receipt for Phoenix worker-power work.",
    ),
    _DemoLane(
        brief_title="Milwaukee Democracy Field Brief",
        list_name="Milwaukee democracy follow-up",
        list_description="Seeded follow-up list for the Milwaukee democracy Briefing Room demo.",
        location_query="Milwaukee, WI",
        state="WI",
        issue_areas=(
            "voter_suppression_and_electoral_access",
            "local_government_and_civic_engagement",
        ),
        research_goal="ecosystem_map",
        entry_slugs=("great-lakes-civic-lab", "aisha-patel"),
        buyer_segment="pro-democracy organizations, foundations, and campaigns",
        summary=(
            "Milwaukee democracy coverage centers on Great Lakes Civic Lab and Aisha "
            "Patel. The lane demonstrates a source-backed path from civic data tools "
            "to turnout infrastructure, volunteer networks, and reviewable gaps before "
            "a campaign or foundation uses the intelligence."
        ),
        gaps=(
            {
                "label": "Partner coverage",
                "detail": "Neighborhood groups and election-protection partners need more sources.",
            },
            {
                "label": "Active cycle timing",
                "detail": "The seed does not yet confirm next election-cycle milestones.",
            },
        ),
        reasoning_signals=(
            "The organization and technologist records share election-access source context.",
            "Sources identify civic tools, turnout infrastructure, and volunteer coordination.",
            "Cycle timing and partner coverage remain explicit follow-up gaps.",
        ),
        source_reason="This source gives the brief a public receipt for Milwaukee democracy work.",
    ),
)
DEMO_BRIEF_TITLES = tuple(lane.brief_title for lane in DEMO_LANES)
DEMO_LIST_NAMES = tuple(lane.list_name for lane in DEMO_LANES)


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
    """Remove prior private demo artifacts while preserving public profile seed data.

    Parameters
    ----------
    conn
        Open database connection.
    org_id
        Workspace ID whose prior private demo brief should be removed.
    user_id
        Operator user ID whose prior demo saved list should be removed.
    """
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
        "SELECT id FROM discovery_runs WHERE research_summary LIKE ?",
        (f'%"artifact_kind": "{DEMO_ARTIFACT_KIND}"%',),
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
    """Load a seeded profile by slug or fail loudly.

    Parameters
    ----------
    conn
        Open database connection.
    slug
        Vanity slug from the public profile seed.

    Returns
    -------
    EntryModel
        The seeded public profile.
    """
    entry = await EntryCRUD.get_by_slug(conn, slug)
    if entry is None:
        msg = f"Required demo profile is missing: {slug}"
        raise RuntimeError(msg)
    return entry


async def _source_receipts_for_entries(
    conn: aiosqlite.Connection, entry_ids: list[str]
) -> list[_SourceReceipt]:
    """Return unique source receipts linked to the seeded demo entries.

    Parameters
    ----------
    conn
        Open database connection.
    entry_ids
        Entry IDs included in the demo brief.

    Returns
    -------
    list[_SourceReceipt]
        Ordered source receipts for the research summary and brief export.
    """
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
    """Return source count and latest source date for one entry.

    Parameters
    ----------
    conn
        Open database connection.
    entry_id
        Entry ID to inspect.

    Returns
    -------
    _EntrySourceStats
        Source count and latest date for the entry.
    """
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
    """Build a ranked lead payload for the seeded research summary.

    Parameters
    ----------
    conn
        Open database connection.
    entry
        Seeded profile included in the brief.
    lane
        Demo lane that frames the buyer-ready lead.

    Returns
    -------
    dict[str, Any]
        Discovery research lead payload.
    """
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
        "confidence": (
            "corroborated" if stats.source_count >= CORROBORATED_SOURCE_THRESHOLD else "partial"
        ),
        "latest_source_date": stats.latest_source_date,
    }


def _key_source_payload(source: _SourceReceipt, lane: _DemoLane) -> dict[str, Any]:
    """Build a key source payload for the seeded research summary.

    Parameters
    ----------
    source
        Source receipt linked to the demo actors.
    lane
        Demo lane that frames the source receipt.

    Returns
    -------
    dict[str, Any]
        Discovery research source payload.
    """
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
    """Build the completed research summary used by the demo discovery run.

    Parameters
    ----------
    conn
        Open database connection.
    lane
        Demo lane used for the private brief.
    entries
        Seeded actor profiles included in the demo.
    sources
        Source receipts linked to the seeded profiles.

    Returns
    -------
    dict[str, Any]
        Structured discovery research summary.
    """
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
    """Build the explicit scope stored on the seeded Atlas Brief.

    Parameters
    ----------
    lane
        Demo lane used for the private brief.
    sources
        Source receipts linked to the seeded profiles.

    Returns
    -------
    dict[str, Any]
        Brief scope payload.
    """
    source_types = sorted({source.source_type for source in sources})
    return {
        "actor_types": ["organization", "person"],
        "geography": lane.location_query,
        "issue_areas": list(lane.issue_areas),
        "source_types": source_types,
    }


async def seed_briefing_room_demo(
    database_url: str = "sqlite:///atlas.db",
    *,
    org_id: str = DEMO_ORG_ID,
    reset: bool = True,
    user_id: str = DEMO_USER_ID,
) -> DemoSeedResult:
    """Seed the first-customer Atlas Briefing Room demo data.

    Parameters
    ----------
    database_url
        Database URL to seed.
    org_id
        Workspace ID that should own the private demo brief.
    reset
        When true, removes prior private demo artifacts before creating fresh
        ones while preserving public profile seed data.
    user_id
        Operator user ID that should own the demo saved list and brief.

    Returns
    -------
    DemoSeedResult
        IDs for the created demo artifacts.
    """
    await seed_profiles(database_url)
    conn = await get_db_connection(database_url)
    try:
        await conn.execute("PRAGMA busy_timeout = 30000")
        if reset:
            await _reset_demo_artifacts(conn, org_id=org_id, user_id=user_id)

        brief_ids: list[str] = []
        discovery_run_ids: list[str] = []
        saved_list_ids: list[str] = []
        primary_entry_ids: list[str] = []
        primary_source_ids: list[str] = []

        for lane_index, lane in enumerate(DEMO_LANES):
            entries = [await _get_required_entry(conn, slug) for slug in lane.entry_slugs]
            entry_ids = [entry.id for entry in entries]
            source_receipts = await _source_receipts_for_entries(conn, entry_ids)
            source_ids = [source.id for source in source_receipts]

            run_id = await DiscoveryRunCRUD.create(
                conn,
                location_query=lane.location_query,
                state=lane.state,
                issue_areas=list(lane.issue_areas),
                research_goal=lane.research_goal,
            )
            summary = await _research_summary(conn, lane, entries, source_receipts)
            await DiscoveryRunCRUD.update_research_summary(conn, run_id, summary)
            await DiscoveryRunCRUD.complete(
                conn,
                run_id,
                queries_generated=4,
                sources_fetched=len(source_ids),
                sources_processed=len(source_ids),
                entries_extracted=len(entry_ids),
                entries_after_dedup=len(entry_ids),
                entries_confirmed=len(entry_ids),
            )
            await OwnershipCRUD.create_ownership(
                conn,
                resource_id=run_id,
                resource_type="discovery_run",
                org_id=org_id,
                visibility="private",
                created_by=user_id,
            )

            brief = await OrgBriefCRUD.create(
                conn,
                org_id=org_id,
                title=lane.brief_title,
                scope=_brief_scope(lane, source_receipts),
                summary=str(summary["brief"]),
                linked_entry_ids=entry_ids,
                linked_source_ids=source_ids,
                linked_discovery_run_ids=[run_id],
                confidence_summary={
                    "state": "corroborated",
                    "source_count": len(source_ids),
                    "review_status": "operator_review_required",
                },
                gaps=list(summary["gaps"]),
                created_by=user_id,
            )

            saved_list = await SavedListCRUD.create(
                conn,
                user_id=user_id,
                name=lane.list_name,
                description=lane.list_description,
            )
            for entry in entries:
                await SavedListCRUD.add_item(
                    conn,
                    list_id=saved_list.id,
                    entry_id=entry.id,
                    note=f"Seeded from {lane.brief_title}.",
                )

            brief_ids.append(brief.id)
            discovery_run_ids.append(run_id)
            saved_list_ids.append(saved_list.id)
            if lane_index == 0:
                primary_entry_ids = entry_ids
                primary_source_ids = source_ids

        return DemoSeedResult(
            org_id=org_id,
            user_id=user_id,
            brief_ids=brief_ids,
            discovery_run_ids=discovery_run_ids,
            entry_ids=primary_entry_ids,
            source_ids=primary_source_ids,
            saved_list_ids=saved_list_ids,
            discovery_run_id=discovery_run_ids[0],
            brief_id=brief_ids[0],
            saved_list_id=saved_list_ids[0],
        )
    finally:
        await conn.close()


def _normalize_cli_args(argv: Sequence[str] | None) -> list[str] | None:
    """Remove a package-manager separator when one is forwarded to Python.

    Parameters
    ----------
    argv
        Optional argument vector supplied by tests or the command line.

    Returns
    -------
    list[str] | None
        Normalized arguments for argparse.
    """
    normalized = list(sys.argv[1:] if argv is None else argv)
    if normalized[:1] == ["--"]:
        return normalized[1:]
    return normalized


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments.

    Parameters
    ----------
    argv
        Optional argument vector. Defaults to ``sys.argv`` through argparse.

    Returns
    -------
    argparse.Namespace
        Parsed command-line options.
    """
    parser = argparse.ArgumentParser(description="Seed the Atlas Briefing Room demo.")
    parser.add_argument(
        "--database-url",
        default=os.getenv("DATABASE_URL", "sqlite:///atlas.db"),
        help="Database URL to seed. Defaults to DATABASE_URL or sqlite:///atlas.db.",
    )
    parser.add_argument(
        "--org-id",
        default=DEMO_ORG_ID,
        help=f"Workspace ID that should own the demo brief. Defaults to {DEMO_ORG_ID}.",
    )
    parser.add_argument(
        "--no-reset",
        action="store_true",
        help="Create another demo artifact set instead of replacing the prior one.",
    )
    parser.add_argument(
        "--user-id",
        default=DEMO_USER_ID,
        help=f"Operator user ID that should own the demo saved list. Defaults to {DEMO_USER_ID}.",
    )
    return parser.parse_args(_normalize_cli_args(argv))


def main() -> None:
    """Seed the demo database from the command line."""
    args = _parse_args()
    result = asyncio.run(
        seed_briefing_room_demo(
            args.database_url,
            org_id=args.org_id,
            reset=not args.no_reset,
            user_id=args.user_id,
        )
    )
    print(
        "Seeded Atlas Briefing Room demo: "
        f"brief={result.brief_id} run={result.discovery_run_id} list={result.saved_list_id}"
    )


if __name__ == "__main__":
    main()
