"""Signed-in request headers for tests that separate Atlas staff from customers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from tests.support.app_assertions import configure_test_app_issuer, sign_app_assertion

if TYPE_CHECKING:
    from atlas.platform.config import Settings

LEGACY_SHARED_SECRET = "internal-test-secret"  # pragma: allowlist secret
"""A value the API no longer reads; tests send it to prove it carries no authority."""
STAFF_EMAIL = "editor@rebuildingus.org"
VISITOR_EMAIL = "visitor@example.org"


@dataclass(frozen=True)
class StaffAuthHeaders:
    """Headers the Atlas app sends for an ordinary account and for an operator."""

    ordinary: dict[str, str]
    staff: dict[str, str]

    @staticmethod
    def ordinary_in(org_id: str) -> dict[str, str]:
        """Return headers for the ordinary account acting in one workspace.

        Parameters
        ----------
        org_id : str
            The workspace the session has active.

        Returns
        -------
        dict[str, str]
            A signed app assertion for the visitor with that active workspace.
        """
        return _assertion_headers("user_visitor", VISITOR_EMAIL, org_id=org_id)


def _assertion_headers(user_id: str, email: str, *, org_id: str | None = None) -> dict[str, str]:
    return {
        "X-Atlas-Actor-Assertion": sign_app_assertion(
            user_id=user_id, email=email, account_ready=True, org_id=org_id
        )
    }


def enable_staff_auth(settings: Settings) -> StaffAuthHeaders:
    """Turn on signed-in auth and return headers for a customer and an operator.

    The API must also trust the test app key; the ``trust_test_app_keys``
    autouse fixture in ``tests/conftest.py`` does that for every test.

    Parameters
    ----------
    settings : Settings
        Test settings shared with the app under test; mutated in place.

    Returns
    -------
    StaffAuthHeaders
        Signed app assertions for an ordinary signed-in account and for an
        allowlisted operator whose email differs only in case, both from
        passkey-ready sessions.
    """
    settings.multi_user = True
    settings.instance_operator_emails = [STAFF_EMAIL]
    configure_test_app_issuer(settings)
    return StaffAuthHeaders(
        ordinary=_assertion_headers("user_visitor", VISITOR_EMAIL),
        staff=_assertion_headers("user_editor", STAFF_EMAIL.upper()),
    )
