"""Tests for operator cloud-cost posture API."""

from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING

import httpx
import pytest
from fastapi import Response

from atlas.config import Settings, get_settings
from atlas.domains.access.api.cloud_cost_admin import get_cloud_cost_posture
from atlas.domains.discovery.cost import record_cost
from atlas.domains.discovery.models import DiscoveryRunCRUD
from atlas.main import create_app

if TYPE_CHECKING:
    import aiosqlite


@pytest.mark.asyncio
async def test_cloud_cost_posture_requires_internal_operator(db_url: str) -> None:
    """Hosted cloud-cost posture should not be public API data."""
    app = create_app()

    def override_get_settings() -> Settings:
        return Settings(
            managed=True,
            database_url=db_url,
            multi_user=True,
            auth_internal_secret="internal-test-secret",  # pragma: allowlist secret
            auth_jwt_audience=["https://atlas.example.test/mcp"],
            auth_jwt_issuer="https://atlas.example.test",
            auth_api_key_introspection_url=(  # pragma: allowlist secret
                "https://atlas.example.test/api/auth/internal/introspect"
            ),
            auth_membership_verification_url=(
                "https://atlas.example.test/api/auth/internal/memberships"
            ),
        )

    app.dependency_overrides[get_settings] = override_get_settings
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/admin/cloud-costs")

    assert response.status_code == HTTPStatus.UNAUTHORIZED


@pytest.mark.asyncio
async def test_cloud_cost_posture_allows_allowlisted_operator(db_url: str) -> None:
    """Allowlisted Atlas operators can load cloud-cost posture."""
    app = create_app()

    def override_get_settings() -> Settings:
        return Settings(
            managed=True,
            database_url=db_url,
            multi_user=True,
            auth_internal_secret="internal-test-secret",  # pragma: allowlist secret
            operator_allowed_emails=["ops@rebuildingus.org"],
            auth_jwt_audience=["https://atlas.example.test/mcp"],
            auth_jwt_issuer="https://atlas.example.test",
            auth_api_key_introspection_url=(  # pragma: allowlist secret
                "https://atlas.example.test/api/auth/internal/introspect"
            ),
            auth_membership_verification_url=(
                "https://atlas.example.test/api/auth/internal/memberships"
            ),
        )

    app.dependency_overrides[get_settings] = override_get_settings
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/admin/cloud-costs",
            headers={
                "X-Atlas-Actor-Email": "ops@rebuildingus.org",
                "X-Atlas-Actor-Id": "ops-user",
                "X-Atlas-Internal-Secret": "internal-test-secret",  # pragma: allowlist secret
            },
        )

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
