"""A platform route runs only when the admin app and the operator's Access sign-in agree."""

from __future__ import annotations

import hashlib
import json
from http import HTTPStatus
from typing import TYPE_CHECKING

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from atlas.platform.authz import Action, AuditLogCRUD, require_platform_action
from atlas.platform.authz.platform_guard import (
    ADMIN_CREDENTIAL_DETAIL,
    INVALID_SIGN_IN_DETAIL,
    MISMATCHED_OPERATOR_DETAIL,
    MISSING_SIGN_IN_DETAIL,
    NOT_AN_OPERATOR_DETAIL,
    NOT_CONFIGURED_DETAIL,
)
from tests.support.platform_admin import (
    OPERATOR_EMAIL,
    admin_issuers,
    platform_settings,
    sign_access_token,
    sign_admin_token,
    trust_test_access_team,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    import aiosqlite

    from atlas.platform.config import Settings

STATIC_KEY = "static-admin-stand-in-" + "k" * 40  # pragma: allowlist secret


@pytest.fixture(autouse=True)
def _test_access_team(monkeypatch: pytest.MonkeyPatch) -> None:
    trust_test_access_team(monkeypatch)


def _request(
    method: str = "GET",
    *,
    admin_token: str | None = None,
    access_token: str | None = None,
) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if admin_token is not None:
        headers.append((b"authorization", f"Bearer {admin_token}".encode()))
    if access_token is not None:
        headers.append((b"cf-access-jwt-assertion", access_token.encode()))
    return Request(
        {
            "type": "http",
            "method": method,
            "path": "/api/platform/discount-verifications/v-1",
            "headers": headers,
            "path_params": {"verification_id": "v-1"},
            "query_string": b"",
        }
    )


def _signed_in(method: str = "GET", email: str = OPERATOR_EMAIL) -> Request:
    return _request(
        method, admin_token=sign_admin_token(email), access_token=sign_access_token(email)
    )


async def _refusal(request: Request, settings: Settings) -> HTTPException:
    with pytest.raises(HTTPException) as exc_info:
        await require_platform_action(Action.DISCOUNTS_REVIEW)(request, settings)
    return exc_info.value


def test_only_guards_platform_actions() -> None:
    with pytest.raises(ValueError, match="not a platform action"):
        require_platform_action(Action.CLAIMS_REVIEW)


async def test_admits_the_admin_app_acting_for_a_signed_in_operator() -> None:
    operator = await require_platform_action(Action.DISCOUNTS_REVIEW)(
        _signed_in(), platform_settings()
    )

    assert operator.email == OPERATOR_EMAIL
    assert operator.app.issuer_name == "atlas-admin"


async def test_a_self_hosted_deployment_has_no_platform_surface() -> None:
    refusal = await _refusal(_signed_in(), platform_settings(managed=False))

    assert refusal.status_code == HTTPStatus.NOT_FOUND


# Tokens are minted inside each test, never at collection, so a long suite
# cannot let them expire before the test that uses them runs.
@pytest.mark.parametrize(
    "admin_token_factory",
    [
        lambda: None,
        lambda: "not-a-token",
        lambda: sign_admin_token(acting_for=None),
        lambda: STATIC_KEY,
    ],
)
async def test_requires_the_admin_apps_own_token_naming_a_person(
    admin_token_factory: Callable[[], str | None],
) -> None:
    issuers = json.loads(admin_issuers())
    issuers.append(
        {
            "kind": "static_key",
            "name": "not-the-admin",
            "key_sha256": hashlib.sha256(STATIC_KEY.encode()).hexdigest(),
            "actions": ["platform.discounts.review"],
        }
    )
    settings = platform_settings(machine_trusted_issuers=json.dumps(issuers))
    request = _request(admin_token=admin_token_factory(), access_token=sign_access_token())

    refusal = await _refusal(request, settings)

    assert refusal.status_code == HTTPStatus.UNAUTHORIZED
    assert refusal.detail == ADMIN_CREDENTIAL_DETAIL


async def test_refuses_an_admin_app_not_trusted_for_the_action() -> None:
    settings = platform_settings(machine_trusted_issuers=admin_issuers(["platform.costs.view"]))

    refusal = await _refusal(_signed_in(), settings)

    assert refusal.status_code == HTTPStatus.FORBIDDEN


@pytest.mark.parametrize(
    "overrides",
    [
        {"access_team_domain": "", "access_aud": ""},
        {"access_team_domain": "not-a-team.example.org"},
    ],
)
async def test_refuses_when_access_is_not_configured(overrides: dict[str, str]) -> None:
    refusal = await _refusal(_signed_in(), platform_settings(**overrides))

    assert refusal.status_code == HTTPStatus.SERVICE_UNAVAILABLE
    assert refusal.detail == NOT_CONFIGURED_DETAIL


@pytest.mark.parametrize(
    ("access_token_factory", "detail"),
    [
        (lambda: None, MISSING_SIGN_IN_DETAIL),
        (lambda: sign_access_token(aud=["another-application"]), INVALID_SIGN_IN_DETAIL),
        (lambda: sign_access_token("someone@rebuildingus.org"), MISMATCHED_OPERATOR_DETAIL),
    ],
)
async def test_requires_the_operators_own_access_sign_in(
    access_token_factory: Callable[[], str | None], detail: str
) -> None:
    request = _request(admin_token=sign_admin_token(), access_token=access_token_factory())

    refusal = await _refusal(request, platform_settings())

    assert refusal.status_code == HTTPStatus.FORBIDDEN
    assert refusal.detail == detail


async def test_refuses_a_signed_in_person_who_is_not_a_platform_operator() -> None:
    refusal = await _refusal(_signed_in(email="volunteer@rebuildingus.org"), platform_settings())

    assert refusal.status_code == HTTPStatus.FORBIDDEN
    assert refusal.detail == NOT_AN_OPERATOR_DETAIL


async def test_records_platform_decisions_under_the_operators_email(
    test_db: aiosqlite.Connection, db_url: str
) -> None:
    settings = platform_settings(db_url)
    guard = require_platform_action(Action.DISCOUNTS_REVIEW)

    await guard(_signed_in("PATCH"), settings)
    with pytest.raises(HTTPException):
        await guard(_signed_in("PATCH", email="volunteer@rebuildingus.org"), settings)

    entries = await AuditLogCRUD.list_recent(test_db, limit=5, action=Action.DISCOUNTS_REVIEW)
    assert sorted((entry.actor_email, entry.allowed, entry.plane) for entry in entries) == [
        ("volunteer@rebuildingus.org", False, "staff"),
        (OPERATOR_EMAIL, True, "staff"),
    ]
    assert {entry.auth_type for entry in entries} == {"platform_admin:atlas-admin"}
    assert {entry.route for entry in entries} == {"/api/platform/discount-verifications/v-1"}
