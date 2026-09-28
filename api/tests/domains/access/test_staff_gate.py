"""The staff gate admits only allowlisted operators signed in through the Atlas app."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.access.staff import (
    STAFF_REQUIRED_DETAIL,
    ensure_atlas_staff,
    require_atlas_staff,
)

HTTP_FORBIDDEN = 403
OPERATOR = "editor@rebuildingus.org"


def _actor(*, auth_type: str = "internal", email: str = OPERATOR) -> AuthenticatedActor:
    return AuthenticatedActor(
        user_id="user_1",
        email=email,
        auth_type=auth_type,
        permissions={"discovery": ["read", "write"]},
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("auth_type", ["api_key", "oauth_jwt"])
async def test_customer_credentials_never_pass_the_staff_gate(
    test_settings: object,
    auth_type: str,
) -> None:
    test_settings.operator_allowed_emails = [OPERATOR]

    with pytest.raises(HTTPException) as exc:
        await require_atlas_staff(actor=_actor(auth_type=auth_type), settings=test_settings)

    assert exc.value.status_code == HTTP_FORBIDDEN
    assert exc.value.detail == STAFF_REQUIRED_DETAIL


@pytest.mark.asyncio
async def test_allowlisted_operator_passes_regardless_of_email_case(test_settings: object) -> None:
    test_settings.operator_allowed_emails = [f" {OPERATOR.upper()} ", ""]
    actor = _actor(email=f"{OPERATOR} ")

    assert await require_atlas_staff(actor=actor, settings=test_settings) is actor


def test_signed_in_account_outside_the_allowlist_is_refused(test_settings: object) -> None:
    test_settings.operator_allowed_emails = [OPERATOR]

    with pytest.raises(HTTPException) as exc:
        ensure_atlas_staff(
            _actor(email="visitor@example.org"),
            test_settings,
            detail="Editorial review requires Atlas staff.",
        )

    assert exc.value.status_code == HTTP_FORBIDDEN
    assert exc.value.detail == "Editorial review requires Atlas staff."


def test_empty_allowlist_refuses_everyone_signed_in(test_settings: object) -> None:
    test_settings.operator_allowed_emails = []

    with pytest.raises(HTTPException):
        ensure_atlas_staff(_actor(), test_settings, detail=STAFF_REQUIRED_DETAIL)


def test_local_single_user_mode_is_staff(test_settings: object) -> None:
    test_settings.operator_allowed_emails = []
    actor = AuthenticatedActor(user_id="local", email="", auth_type="local", is_local=True)

    assert ensure_atlas_staff(actor, test_settings, detail=STAFF_REQUIRED_DETAIL) is actor
