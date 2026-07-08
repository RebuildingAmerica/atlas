"""Seed a resettable first-customer Atlas Briefing Room demo."""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from dataclasses import dataclass
from typing import TYPE_CHECKING

from atlas.domains.access.models.saved_lists import SavedListCRUD
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.briefs import OrgBriefCRUD
from atlas.domains.discovery.models import DiscoveryRunCRUD
from atlas.models import get_db_connection
from atlas.seed_briefing_room_demo_data import (
    DEMO_BRIEF_TITLE,
    DEMO_BRIEF_TITLES,
    DEMO_LANES,
    DEMO_LIST_NAME,
    DEMO_LIST_NAMES,
    DEMO_ORG_ID,
    DEMO_USER_ID,
)
from atlas.seed_briefing_room_demo_support import (
    _brief_scope,
    _get_required_entry,
    _research_summary,
    _reset_demo_artifacts,
    _source_receipts_for_entries,
)
from atlas.seed_profiles import seed_profiles

if TYPE_CHECKING:
    from collections.abc import Sequence

__all__ = [
    "DEMO_BRIEF_TITLE",
    "DEMO_BRIEF_TITLES",
    "DEMO_LIST_NAME",
    "DEMO_LIST_NAMES",
    "DEMO_ORG_ID",
    "DEMO_USER_ID",
    "_parse_args",
    "seed_briefing_room_demo",
]


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


async def seed_briefing_room_demo(
    database_url: str = "sqlite:///atlas.db",
    *,
    org_id: str = DEMO_ORG_ID,
    reset: bool = True,
    user_id: str = DEMO_USER_ID,
) -> DemoSeedResult:
    """Seed the first-customer Atlas Briefing Room demo data."""
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
    """Remove a package-manager separator when one is forwarded to Python."""
    normalized = list(sys.argv[1:] if argv is None else argv)
    if normalized[:1] == ["--"]:
        return normalized[1:]
    return normalized


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments."""
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
