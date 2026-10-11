"""The platform admin looks up an account without production SQL, and every lookup is audited."""

from __future__ import annotations

import json
from http import HTTPStatus
from typing import TYPE_CHECKING, Any

import httpx
import pytest

from atlas.domains.access.api import account_lookup_admin
from atlas.domains.access.api.account_lookup_admin import APP_UNREACHABLE_DETAIL, LOOKUP_PATH
from atlas.domains.access.models.discount_verifications import (
    DiscountVerificationCreate,
    DiscountVerificationCRUD,
)
from atlas.platform.authz import Action, AuditLogCRUD
from tests.support.platform_admin import (
    OPERATOR_EMAIL,
    managed_app,
    platform_headers,
    platform_settings,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    import aiosqlite

LOOKUP = "/api/platform/accounts/lookup"

APP_ANSWER: dict[str, Any] = {
    "account": {
        "created_at": "2026-09-01T12:00:00.000Z",
        "email": "dana@example.org",
        "email_verified": True,
        "id": "user_dana",
        "name": "Dana",
    },
    "workspaces": [
        {
            "adjustments": [],
            "id": "org_team",
            "members": [{"email": "dana@example.org", "role": "owner"}],
            "name": "Reno Tenants",
            "products": [
                {
                    "expires_at": None,
                    "granted_at": "2026-09-03T12:00:00.000Z",
                    "product": "atlas_team",
                    "purchase_intent_id": None,
                    "status": "active",
                    "stripe_subscription_id": None,
                }
            ],
            "purchases": [],
            "slug": "reno-tenants",
        }
    ],
}


_REAL_CLIENT = httpx.AsyncClient
"""Kept before any test patches the module, so the test's own client stays real."""


def _app(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[httpx.Request], httpx.Response],
) -> None:
    monkeypatch.setattr(
        account_lookup_admin.httpx,
        "AsyncClient",
        lambda **kwargs: _REAL_CLIENT(transport=httpx.MockTransport(handler), **kwargs),
    )


async def _lookup(
    monkeypatch: pytest.MonkeyPatch, db_url: str, query: str, *, headers: bool = True
) -> httpx.Response:
    app = managed_app(monkeypatch, platform_settings(db_url))
    async with _REAL_CLIENT(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        return await client.post(
            LOOKUP, json={"query": query}, headers=platform_headers() if headers else {}
        )


async def test_a_lookup_joins_what_the_app_knows_with_the_workspace_discounts(
    monkeypatch: pytest.MonkeyPatch, db_url: str, test_db: aiosqlite.Connection
) -> None:
    await DiscountVerificationCRUD.create(
        test_db,
        DiscountVerificationCreate(
            user_id="user_dana",
            organization_id="org_team",
            segment="student",
            method="school_email",
            verification_data={"schoolEmail": "dana@example.edu"},
        ),
    )
    asked: list[dict[str, object]] = []

    def _answer(request: httpx.Request) -> httpx.Response:
        assert request.url.path == LOOKUP_PATH
        assert (
            request.headers["X-Atlas-Callback-Secret"]
            == "callback-test-secret"  # pragma: allowlist secret
        )  # pragma: allowlist secret
        asked.append(json.loads(request.content))
        return httpx.Response(200, json=APP_ANSWER)

    _app(monkeypatch, _answer)
    response = await _lookup(monkeypatch, db_url, " dana@example.org ")

    assert response.status_code == HTTPStatus.OK
    assert asked == [{"query": "dana@example.org"}]
    workspace = response.json()["workspaces"][0]
    assert workspace["products"][0]["purchase_intent_id"] is None
    assert [(item["segment"], item["status"]) for item in workspace["discounts"]] == [
        ("student", "pending")
    ]
    entries = await AuditLogCRUD.list_recent(test_db, limit=5, action=Action.ACCOUNTS_READ)
    assert [(entry.actor_email, entry.allowed) for entry in entries] == [(OPERATOR_EMAIL, True)]


async def test_a_lookup_needs_the_admin_app(monkeypatch: pytest.MonkeyPatch, db_url: str) -> None:
    response = await _lookup(monkeypatch, db_url, "dana@example.org", headers=False)

    assert response.status_code == HTTPStatus.UNAUTHORIZED


@pytest.mark.parametrize(
    "reply",
    [
        httpx.Response(500),
        httpx.Response(200, json={"unexpected": True}),
    ],
)
async def test_an_app_that_cannot_answer_is_reported_not_guessed(
    monkeypatch: pytest.MonkeyPatch, db_url: str, reply: httpx.Response
) -> None:
    _app(monkeypatch, lambda _request: reply)

    response = await _lookup(monkeypatch, db_url, "dana@example.org")

    assert response.status_code == HTTPStatus.BAD_GATEWAY
    assert response.json()["detail"] == APP_UNREACHABLE_DETAIL
