"""Tests for the first-customer Briefing Room demo seed."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from atlas.domains.access.models.saved_lists import SavedListCRUD
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.briefs import OrgBriefCRUD
from atlas.domains.discovery.models import DiscoveryRunCRUD
from atlas.models import EntryCRUD, get_db_connection
from atlas.seed_briefing_room_demo import (
    DEMO_BRIEF_TITLE,
    DEMO_BRIEF_TITLES,
    DEMO_LIST_NAME,
    DEMO_LIST_NAMES,
    DEMO_ORG_ID,
    DEMO_USER_ID,
    _parse_args,
    seed_briefing_room_demo,
)

if TYPE_CHECKING:
    import aiosqlite

REPO_ROOT = Path(__file__).resolve().parents[2]
EXPECTED_DEMO_LEAD_COUNT = 2
EXPECTED_DEMO_LANE_COUNT = 3


async def _count_rows(conn: aiosqlite.Connection, sql: str, params: tuple[str, ...]) -> int:
    cursor = await conn.execute(sql, params)
    row = await cursor.fetchone()
    return int(row[0]) if row is not None else 0


@pytest.mark.asyncio
async def test_seed_briefing_room_demo_creates_resettable_private_demo_artifacts(
    db_url: str,
) -> None:
    """The demo seed should create the exact private artifacts needed for a buyer walkthrough."""
    first_result = await seed_briefing_room_demo(db_url, reset=True)
    second_result = await seed_briefing_room_demo(db_url, reset=True)

    assert first_result.brief_id != second_result.brief_id

    conn = await get_db_connection(db_url)
    try:
        eastside = await EntryCRUD.get_by_slug(conn, "eastside-housing-network")
        maya = await EntryCRUD.get_by_slug(conn, "maya-thompson")
        assert eastside is not None
        assert maya is not None
        assert second_result.entry_ids == [eastside.id, maya.id]

        run = await DiscoveryRunCRUD.get_by_id(conn, second_result.discovery_run_id)
        assert run is not None
        assert run.status == "completed"
        assert run.location_query == "Detroit, MI"
        assert run.state == "MI"
        assert run.issue_areas == ["housing_affordability"]
        assert run.research_summary is not None
        assert run.research_summary["artifact_kind"] == "briefing_room_demo"
        assert len(run.research_summary["ranked_leads"]) == EXPECTED_DEMO_LEAD_COUNT
        assert len(run.research_summary["key_sources"]) == len(second_result.source_ids)
        run_ownership = await OwnershipCRUD.get_ownership(
            conn, second_result.discovery_run_id, "discovery_run"
        )
        assert run_ownership is not None
        assert run_ownership.org_id == DEMO_ORG_ID
        assert run_ownership.visibility == "private"

        brief = await OrgBriefCRUD.get(conn, second_result.brief_id)
        assert brief is not None
        assert brief.org_id == DEMO_ORG_ID
        assert brief.title == DEMO_BRIEF_TITLE
        assert brief.created_by == DEMO_USER_ID
        assert brief.linked_entry_ids == second_result.entry_ids
        assert brief.linked_source_ids == second_result.source_ids
        assert brief.linked_discovery_run_ids == [second_result.discovery_run_id]
        assert brief.confidence_summary["review_status"] == "operator_review_required"
        assert brief.gaps
        assert len(second_result.brief_ids) == EXPECTED_DEMO_LANE_COUNT
        seeded_briefs = [
            await OrgBriefCRUD.get(conn, brief_id) for brief_id in second_result.brief_ids
        ]
        assert [item.title for item in seeded_briefs if item is not None] == list(DEMO_BRIEF_TITLES)

        saved_lists = await SavedListCRUD.list_for_user(conn, DEMO_USER_ID)
        assert {saved_list.name for saved_list in saved_lists} == set(DEMO_LIST_NAMES)
        saved_items = await SavedListCRUD.list_items(conn, second_result.saved_list_id)
        assert {item.entry_id for item in saved_items} == set(second_result.entry_ids)

        assert (
            await _count_rows(
                conn,
                "SELECT COUNT(*) FROM org_briefs WHERE org_id = ? AND title = ?",
                (DEMO_ORG_ID, DEMO_BRIEF_TITLE),
            )
            == 1
        )
        assert (
            await _count_rows(
                conn,
                "SELECT COUNT(*) FROM saved_lists WHERE user_id = ? AND name = ?",
                (DEMO_USER_ID, DEMO_LIST_NAME),
            )
            == 1
        )
        assert (
            await _count_rows(
                conn,
                """
                SELECT COUNT(*) FROM discovery_runs
                WHERE research_summary LIKE ?
                """,
                ('%"artifact_kind": "briefing_room_demo"%',),
            )
            == EXPECTED_DEMO_LANE_COUNT
        )
        assert (
            await _count_rows(
                conn,
                """
                SELECT COUNT(*)
                FROM resource_ownership ownership
                JOIN discovery_runs run ON run.id = ownership.resource_id
                WHERE ownership.resource_type = ?
                  AND ownership.org_id = ?
                  AND ownership.visibility = ?
                  AND run.research_summary LIKE ?
                """,
                (
                    "discovery_run",
                    DEMO_ORG_ID,
                    "private",
                    '%"artifact_kind": "briefing_room_demo"%',
                ),
            )
            == EXPECTED_DEMO_LANE_COUNT
        )
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_seed_briefing_room_demo_accepts_hosted_workspace_identity(
    db_url: str,
) -> None:
    """Hosted demos should seed artifacts for the provisioned app workspace and user."""
    result = await seed_briefing_room_demo(
        db_url,
        reset=True,
        org_id="briefing-room-demo",
        user_id="demo-operator",
    )

    conn = await get_db_connection(db_url)
    try:
        brief = await OrgBriefCRUD.get(conn, result.brief_id)
        assert brief is not None
        assert result.org_id == "briefing-room-demo"
        assert result.user_id == "demo-operator"
        assert brief.org_id == "briefing-room-demo"
        assert brief.created_by == "demo-operator"

        saved_lists = await SavedListCRUD.list_for_user(conn, "demo-operator")
        assert {saved_list.name for saved_list in saved_lists} == set(DEMO_LIST_NAMES)
    finally:
        await conn.close()


def test_root_package_exposes_briefing_room_demo_seed_command() -> None:
    """The demo should be runnable without remembering the Python module path."""
    package_json = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))

    assert package_json["scripts"]["demo:briefing-room"] == (
        "uv --directory ./api run python -m atlas.seed_briefing_room_demo"
    )
    assert package_json["scripts"]["demo:briefing-room:staging"] == (
        "tsx --tsconfig app/tsconfig.json app/scripts/provision-briefing-room-workspace.ts "
        '&& if [ "${ATLAS_DEMO_DATA:-briefing_room}" != "none" ]; then '
        "uv --directory ./api run python -m atlas.seed_briefing_room_demo "
        "--org-id ${ATLAS_DEMO_ORG_ID:-briefing-room-demo} "
        "--user-id ${ATLAS_DEMO_USER_ID:-briefing-room-operator}; fi"
    )


def test_cli_parser_accepts_extra_package_manager_separator() -> None:
    """A natural pnpm argument separator should not derail the demo command."""
    args = _parse_args(
        [
            "--",
            "--database-url",
            "sqlite:///demo.db",
            "--org-id",
            "briefing-room-demo",
            "--user-id",
            "demo-operator",
        ]
    )

    assert args.database_url == "sqlite:///demo.db"
    assert args.org_id == "briefing-room-demo"
    assert args.user_id == "demo-operator"
    assert args.no_reset is False


def test_cli_parser_normalizes_sys_argv_separator(monkeypatch: pytest.MonkeyPatch) -> None:
    """The real command-line path should normalize a forwarded separator."""
    monkeypatch.setattr(
        sys,
        "argv",
        ["seed_briefing_room_demo.py", "--", "--database-url", "sqlite:///demo.db"],
    )

    args = _parse_args()

    assert args.database_url == "sqlite:///demo.db"
    assert args.no_reset is False


def test_cli_parser_defaults_database_url_from_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Hosted staging should seed the configured API database without extra flags."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://atlas.example/db")

    args = _parse_args([])

    assert args.database_url == "postgresql://atlas.example/db"
