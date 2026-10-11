"""Only the platform admin may read private applicants or decide invitations."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import httpx
import pytest

from atlas.platform.authz import AuditLogCRUD
from tests.support.platform_admin import (
    OPERATOR_EMAIL,
    managed_app,
    platform_headers,
    platform_settings,
)

if TYPE_CHECKING:
    import aiosqlite

_REAL_CLIENT = httpx.AsyncClient


@pytest.mark.parametrize(
    ("path", "body", "operation"),
    [
        ("/api/platform/waitlist", {}, "list"),
        ("/api/platform/waitlist/detail", {"id": "request"}, "detail"),
        ("/api/platform/waitlist/invite", {"ids": ["request"]}, "invite"),
        ("/api/platform/waitlist/action", {"id": "request", "action": "revoke"}, "action"),
    ],
)
async def test_verified_operator_is_forwarded_and_audited(  # noqa: PLR0913
    monkeypatch: pytest.MonkeyPatch,
    db_url: str,
    test_db: aiosqlite.Connection,
    path: str,
    body: dict[str, object],
    operation: str,
) -> None:
    replies = {
        "list": {
            "records": [],
            "availability": {"available": False, "reason": "paused", "allowedOffers": []},
        },
        "detail": {"request": REQUEST, "events": [], "deliveries": []},
        "invite": {"results": [{"id": "request", "status": "sent", "message": "Invitation sent."}]},
        "action": {"request": REQUEST},
    }

    def answer(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/auth/internal/platform-waitlist"
        # Five waves of two 10-second attempts must finish before the callback expires.
        assert request.extensions["timeout"]["read"] >= 150.0
        assert (
            request.headers["X-Atlas-Callback-Secret"]
            == "callback-test-secret"  # pragma: allowlist secret
        )
        assert json.loads(request.content) == {
            "operation": operation,
            "operatorEmail": OPERATOR_EMAIL,
            **body,
        }
        return httpx.Response(200, json=replies[operation])

    app = managed_app(monkeypatch, platform_settings(db_url))
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: _REAL_CLIENT(transport=httpx.MockTransport(answer), **kwargs),
    )
    async with _REAL_CLIENT(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(path, json=body, headers=platform_headers())
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == replies[operation]
    entries = await AuditLogCRUD.list_recent(test_db, limit=5)
    assert any(entry.actor_email == OPERATOR_EMAIL and entry.allowed for entry in entries)


REQUEST = {
    "id": "request",
    "email": "person@example.org",
    "name": "",
    "organization": "",
    "intendedUse": "",
    "product": "atlas_pro",
    "interval": None,
    "status": "waiting",
    "createdAt": "2026-10-10",
    "confirmedAt": "2026-10-10",
    "invitedAt": None,
    "purchasedAt": None,
}


@pytest.mark.parametrize("path", ["", "/detail", "/invite", "/action"])
async def test_customer_and_forged_access_cannot_reach_staff_operations(
    monkeypatch: pytest.MonkeyPatch, db_url: str, path: str
) -> None:
    app = managed_app(monkeypatch, platform_settings(db_url))
    async with _REAL_CLIENT(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for headers in (
            {},
            {"Authorization": "Bearer customer-session", "Cf-Access-Jwt-Assertion": "forged"},
            {**platform_headers(), "Cf-Access-Jwt-Assertion": "forged"},
        ):
            response = await client.post(f"/api/platform/waitlist{path}", json={}, headers=headers)
            assert response.status_code in (401, 403)


@pytest.mark.parametrize(
    "reply",
    [
        httpx.Response(500),
        httpx.Response(200, json={}),
        httpx.Response(400, json={"error": None}),
        httpx.Response(400, text="not json"),
    ],
)
async def test_callback_failures_are_explicit(
    monkeypatch: pytest.MonkeyPatch, db_url: str, reply: httpx.Response
) -> None:
    app = managed_app(monkeypatch, platform_settings(db_url))
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: _REAL_CLIENT(transport=httpx.MockTransport(lambda _: reply), **kwargs),
    )
    async with _REAL_CLIENT(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/api/platform/waitlist", headers=platform_headers())
    assert response.status_code == 502


async def test_applicant_decision_error_is_preserved(
    monkeypatch: pytest.MonkeyPatch, db_url: str
) -> None:
    app = managed_app(monkeypatch, platform_settings(db_url))
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: _REAL_CLIENT(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(
                    400, json={"error": "This request has no active invitation."}
                )
            ),
            **kwargs,
        ),
    )
    async with _REAL_CLIENT(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/platform/waitlist/action",
            json={"id": "one", "action": "resend"},
            headers=platform_headers(),
        )
    assert response.status_code == 400
    assert response.json()["detail"] == "This request has no active invitation."


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("invite", {"ids": []}),
        ("invite", {"ids": [""]}),
        ("invite", {"ids": ["x"] * 51}),
        ("action", {"id": "one", "action": "retry"}),
        ("detail", {"id": "one", "operatorEmail": "forged@example.org"}),
    ],
)
async def test_invalid_decisions_never_reach_the_callback(
    monkeypatch: pytest.MonkeyPatch, db_url: str, path: str, body: dict[str, object]
) -> None:
    app = managed_app(monkeypatch, platform_settings(db_url))
    async with _REAL_CLIENT(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            f"/api/platform/waitlist/{path}", json=body, headers=platform_headers()
        )
    assert response.status_code == 422


async def test_empty_callback_cannot_claim_an_invitation_decision_succeeded(
    monkeypatch: pytest.MonkeyPatch, db_url: str
) -> None:
    app = managed_app(monkeypatch, platform_settings(db_url))
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: _REAL_CLIENT(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json={})), **kwargs
        ),
    )
    async with _REAL_CLIENT(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/platform/waitlist/action",
            json={"id": "one", "action": "revoke"},
            headers=platform_headers(),
        )
    assert response.status_code == 502
