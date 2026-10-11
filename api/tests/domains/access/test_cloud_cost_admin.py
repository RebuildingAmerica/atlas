"""Cloud-cost posture for the platform admin."""

from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING

import httpx
import pytest
from fastapi import Response

from atlas.config import Settings
from atlas.domains.access.api.cloud_cost_admin import get_cloud_cost_posture
from atlas.domains.discovery.cost import record_cost
from atlas.domains.discovery.models import DiscoveryRunCRUD
from tests.support.platform_admin import managed_app, platform_headers, platform_settings

if TYPE_CHECKING:
    import aiosqlite


COSTS = "/api/platform/cloud-costs"


async def test_cloud_cost_posture_requires_the_admin_app(
    monkeypatch: pytest.MonkeyPatch, db_url: str
) -> None:
    """Hosted cloud-cost posture should not be public API data."""
    app = managed_app(monkeypatch, platform_settings(db_url))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(COSTS)

    assert response.status_code == HTTPStatus.UNAUTHORIZED


async def test_cloud_cost_posture_allows_a_platform_operator(
    monkeypatch: pytest.MonkeyPatch, db_url: str
) -> None:
    """The admin app can load cloud-cost posture for a signed-in platform operator."""
    app = managed_app(monkeypatch, platform_settings(db_url))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(COSTS, headers=platform_headers())

    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["posture"] in {"pass", "warn", "block"}
    assert body["billing_export"]["status"] == "not_connected"
    assert body["external_fixed_costs"]["status"] == "not_configured"


@pytest.mark.asyncio
async def test_cloud_cost_posture_reports_discovery_spend_against_daily_ceiling(
    test_db: aiosqlite.Connection,
    db_url: str,
) -> None:
    """The posture response includes durable discovery ledger spend."""
    run_id = await DiscoveryRunCRUD.create(
        test_db,
        location_query="Kansas City, MO",
        state="MO",
        issue_areas=["housing_affordability"],
    )
    await record_cost(
        test_db,
        run_id=run_id,
        kind="llm",
        provider="anthropic",
        units=1000,
        estimated_cost=2.75,
    )
    settings = Settings(
        database_url=db_url,
        discovery_max_daily_cost=10.0,
        discovery_max_run_cost=5.0,
    )

    response = await get_cloud_cost_posture(Response(), test_db, settings=settings)

    assert response.discovery_spend.estimated_daily_usd == 2.75
    assert response.discovery_spend.daily_ceiling_usd == 10.0
    assert response.discovery_spend.posture == "pass"
    assert {guardrail.id for guardrail in response.guardrails} >= {
        "artifact-registry-cleanup",
        "cloud-run-scale-to-zero",
        "cloud-billing-export",
        "external-fixed-costs",
    }


@pytest.mark.asyncio
async def test_cloud_cost_posture_warns_when_discovery_spend_nears_daily_ceiling(
    test_db: aiosqlite.Connection,
    db_url: str,
) -> None:
    """Operators can see spend before it trips the daily ceiling."""
    run_id = await DiscoveryRunCRUD.create(
        test_db,
        location_query="Milwaukee, WI",
        state="WI",
        issue_areas=["worker_cooperatives"],
    )
    await record_cost(
        test_db,
        run_id=run_id,
        kind="search",
        provider="brave",
        units=1,
        estimated_cost=8.0,
    )

    response = await get_cloud_cost_posture(
        Response(),
        test_db,
        settings=Settings(database_url=db_url, discovery_max_daily_cost=10.0),
    )

    assert response.discovery_spend.posture == "warn"
    assert response.posture == "warn"


@pytest.mark.asyncio
async def test_cloud_cost_posture_blocks_when_discovery_daily_ceiling_is_spent(
    test_db: aiosqlite.Connection,
    db_url: str,
) -> None:
    """Operators can see when discovery spend blocks further work."""
    run_id = await DiscoveryRunCRUD.create(
        test_db,
        location_query="Omaha, NE",
        state="NE",
        issue_areas=["housing_affordability"],
    )
    await record_cost(
        test_db,
        run_id=run_id,
        kind="llm",
        provider="anthropic",
        units=1,
        estimated_cost=10.0,
    )

    response = await get_cloud_cost_posture(
        Response(),
        test_db,
        settings=Settings(database_url=db_url, discovery_max_daily_cost=10.0),
    )

    assert response.discovery_spend.posture == "block"
    assert response.posture == "block"


@pytest.mark.asyncio
async def test_cloud_cost_posture_blocks_when_discovery_kill_switch_is_enabled(
    test_db: aiosqlite.Connection,
    db_url: str,
) -> None:
    """The operator kill switch is visible in the admin posture."""
    response = await get_cloud_cost_posture(
        Response(),
        test_db,
        settings=Settings(database_url=db_url, discovery_cost_kill_switch=True),
    )

    assert response.discovery_spend.kill_switch_enabled is True
    assert response.discovery_spend.posture == "block"
    assert response.posture == "block"
