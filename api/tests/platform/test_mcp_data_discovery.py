"""Discovery-run coverage for `atlas.platform.mcp.data`."""
# ruff: noqa

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from atlas.models import DiscoveryRunCRUD
from atlas.platform.mcp.data import AtlasDataService


@pytest.mark.asyncio
async def test_data_service_exposes_discovery_runs_for_agent_clients(
    db_url: str, test_db: object
) -> None:
    """MCP data service should expose structured research artifacts from discovery runs."""
    conn = test_db
    run_id = await DiscoveryRunCRUD.create(
        conn,
        location_query="Kansas City, MO",
        state="MO",
        issue_areas=["housing_affordability"],
        research_goal="interview_leads",
    )
    await DiscoveryRunCRUD.complete(
        conn,
        run_id,
        queries_generated=4,
        sources_fetched=3,
        sources_processed=3,
        entries_extracted=2,
        entries_after_dedup=2,
        entries_confirmed=1,
    )
    await DiscoveryRunCRUD.update_research_summary(
        conn,
        run_id,
        {
            "brief": "One source-backed housing lead in Kansas City.",
            "ranked_leads": [
                {
                    "entry_id": "entry-1",
                    "name": "KC Tenants",
                    "type": "organization",
                    "why_it_matters": "Named in local coverage.",
                    "source_count": 2,
                    "latest_source_date": "2026-04-15",
                }
            ],
            "key_sources": [],
            "gaps": [{"label": "Rural coverage", "detail": "No county lead yet."}],
            "reasoning_signals": ["Ranked 1 lead.", "Flagged 1 gap."],
        },
    )

    service = AtlasDataService(db_url)
    collection = await service.list_discovery_runs(state="MO", status="completed")
    detail = await service.get_discovery_run(run_id)

    assert collection["items"][0]["id"] == run_id
    assert collection["items"][0]["research_summary"]["brief"] == (
        "One source-backed housing lead in Kansas City."
    )
    assert detail["research_summary"]["ranked_leads"][0]["name"] == "KC Tenants"
    assert detail["resource_uri"] == f"atlas://discovery-runs/{run_id}"


@pytest.mark.asyncio
async def test_list_discovery_runs_sets_next_cursor(
    db_url: str,
    test_db: object,
) -> None:
    """Discovery-run listings should advertise pagination when more rows exist."""
    conn = test_db
    for index in range(2):
        await DiscoveryRunCRUD.create(
            conn,
            location_query=f"Kansas City, MO {index}",
            state="MO",
            issue_areas=["housing_affordability"],
        )

    service = AtlasDataService(db_url)
    payload = await service.list_discovery_runs(limit=1)

    assert payload["total"] >= 2
    assert payload["next_cursor"] == "1"


@pytest.mark.asyncio
async def test_get_discovery_run_not_found_raises(db_url: str) -> None:
    """Missing discovery runs should fail with the public not-found error."""
    service = AtlasDataService(db_url)

    with pytest.raises(ValueError, match="Discovery run not found"):
        await service.get_discovery_run("missing-run")
