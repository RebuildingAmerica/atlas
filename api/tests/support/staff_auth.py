"""Signed-in request headers for tests that separate Atlas staff from customers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from atlas.platform.config import Settings

INTERNAL_TEST_SECRET = "internal-test-secret"  # pragma: allowlist secret
STAFF_EMAIL = "editor@rebuildingus.org"


@dataclass(frozen=True)
class StaffAuthHeaders:
    """Headers the Atlas app sends for an ordinary account and for an operator."""

    ordinary: dict[str, str]
    staff: dict[str, str]


def enable_staff_auth(settings: Settings) -> StaffAuthHeaders:
    """Turn on signed-in auth and return headers for a customer and an operator.

    Parameters
    ----------
    settings : Settings
        Test settings shared with the app under test; mutated in place.

    Returns
    -------
    StaffAuthHeaders
        Trusted app headers for an ordinary signed-in account and for an
        allowlisted operator whose email differs only in case.
    """
    settings.multi_user = True
    settings.auth_internal_secret = INTERNAL_TEST_SECRET
    settings.operator_allowed_emails = [STAFF_EMAIL]
    base = {"X-Atlas-Internal-Secret": INTERNAL_TEST_SECRET}
    return StaffAuthHeaders(
        ordinary={
            **base,
            "X-Atlas-Actor-Id": "user_visitor",
            "X-Atlas-Actor-Email": "visitor@example.org",
        },
        staff={
            **base,
            "X-Atlas-Actor-Id": "user_editor",
            "X-Atlas-Actor-Email": STAFF_EMAIL.upper(),
        },
    )
