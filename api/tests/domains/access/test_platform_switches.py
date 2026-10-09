"""Platform switches stop discovery spend and pause sales without a release."""

from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING

import httpx
import pytest

from atlas.domains.access.models.platform_switches import PlatformSwitchCRUD
from atlas.domains.discovery.cost import CostCeilingExceeded, assert_within_budget
from atlas.platform.authz import Action, AuditLogCRUD
from tests.support.platform_admin import (
    OPERATOR_EMAIL,
    managed_app,
    platform_headers,
    platform_settings,
)

if TYPE_CHECKING:
    import aiosqlite

SWITCHES = "/api/platform/switches"


async def _client(monkeypatch: pytest.MonkeyPatch, db_url: str) -> httpx.AsyncClient:
    app = managed_app(monkeypatch, platform_settings(db_url))
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def test_switches_start_released_and_need_the_admin_app(
    monkeypatch: pytest.MonkeyPatch, db_url: str
) -> None:
    async with await _client(monkeypatch, db_url) as client:
        anonymous = await client.get(SWITCHES)
        listed = await client.get(SWITCHES, headers=platform_headers())

    assert anonymous.status_code == HTTPStatus.UNAUTHORIZED
    assert listed.status_code == HTTPStatus.OK
    assert [
        (item["name"], item["engaged"], item["changed_at"]) for item in listed.json()["items"]
    ] == [
        ("discovery_spend", False, None),
        ("checkout", False, None),
    ]


async def test_pausing_checkout_closes_sales_and_records_who_and_why(
    monkeypatch: pytest.MonkeyPatch, db_url: str, test_db: aiosqlite.Connection
) -> None:
    async with await _client(monkeypatch, db_url) as client:
        before = await client.get("/api/service-status")
        paused = await client.put(
            f"{SWITCHES}/checkout",
            json={"engaged": True, "reason": " Stripe is double-charging. "},
            headers=platform_headers(),
        )
        after = await client.get("/api/service-status")
        reopened = await client.put(
            f"{SWITCHES}/checkout",
            json={"engaged": False, "reason": "Stripe fixed it."},
            headers=platform_headers(),
        )
        final = await client.get("/api/service-status")

    assert before.json() == {"checkout_open": True}
    assert before.headers["Cache-Control"] == "public, max-age=30"
    assert paused.status_code == HTTPStatus.OK
    body = paused.json()
    assert (body["engaged"], body["reason"], body["changed_by"]) == (
        True,
        "Stripe is double-charging.",
        OPERATOR_EMAIL,
    )
    assert "T" in body["changed_at"]
    assert after.json() == {"checkout_open": False}
    assert reopened.json()["engaged"] is False
    assert final.json() == {"checkout_open": True}
    entries = await AuditLogCRUD.list_recent(test_db, limit=5, action=Action.SWITCHES_WRITE)
    assert [(entry.actor_email, entry.allowed) for entry in entries] == [
        (OPERATOR_EMAIL, True),
        (OPERATOR_EMAIL, True),
    ]


async def test_a_switch_needs_a_reason_and_a_known_name(
    monkeypatch: pytest.MonkeyPatch, db_url: str
) -> None:
    async with await _client(monkeypatch, db_url) as client:
        no_reason = await client.put(
            f"{SWITCHES}/checkout", json={"engaged": True, "reason": ""}, headers=platform_headers()
        )
        unknown = await client.put(
            f"{SWITCHES}/everything",
            json={"engaged": True, "reason": "Why not"},
            headers=platform_headers(),
        )

    assert no_reason.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert unknown.status_code == HTTPStatus.UNPROCESSABLE_ENTITY


@pytest.mark.asyncio
async def test_the_discovery_spend_switch_stops_every_run_from_spending(
    test_db: aiosqlite.Connection,
) -> None:
    settings = platform_settings()
    await assert_within_budget(test_db, run_id="run-1", settings=settings)

    await PlatformSwitchCRUD.set(
        test_db,
        "discovery_spend",
        engaged=True,
        reason="Runaway search costs.",
        changed_by=OPERATOR_EMAIL,
    )

    with pytest.raises(CostCeilingExceeded, match="discovery spend switch is engaged"):
        await assert_within_budget(test_db, run_id="run-1", settings=settings)


async def test_cloud_costs_show_the_switch_as_a_block(
    monkeypatch: pytest.MonkeyPatch, db_url: str, test_db: aiosqlite.Connection
) -> None:
    await PlatformSwitchCRUD.set(
        test_db, "discovery_spend", engaged=True, reason="Paused.", changed_by=OPERATOR_EMAIL
    )
    async with await _client(monkeypatch, db_url) as client:
        response = await client.get("/api/platform/cloud-costs", headers=platform_headers())

    spend = response.json()["discovery_spend"]
    assert (spend["kill_switch_enabled"], spend["posture"]) == (True, "block")
