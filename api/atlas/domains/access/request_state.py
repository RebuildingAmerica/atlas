"""Request-state helpers shared by auth middleware and dependencies."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .principals import ApiKeyPrincipal

if TYPE_CHECKING:
    from fastapi import Request

API_KEY_PRINCIPAL_STATE_KEY = "_atlas_api_key_principal"
API_KEY_VERIFICATION_ATTEMPTED_STATE_KEY = "_atlas_api_key_verification_attempted"


def mark_api_key_verification(
    request: Request,
    principal: ApiKeyPrincipal | None,
) -> None:
    """Record that API-key verification completed for this request."""
    setattr(request.state, API_KEY_VERIFICATION_ATTEMPTED_STATE_KEY, True)
    if principal is not None:
        setattr(request.state, API_KEY_PRINCIPAL_STATE_KEY, principal)


def api_key_verification_from_state(
    request: Request,
) -> tuple[bool, ApiKeyPrincipal | None]:
    """Return whether API-key verification ran and its verified principal."""
    state = getattr(request, "state", None)
    if state is None:
        return False, None
    attempted = getattr(state, API_KEY_VERIFICATION_ATTEMPTED_STATE_KEY, False) is True
    principal = getattr(state, API_KEY_PRINCIPAL_STATE_KEY, None)
    return attempted, principal if isinstance(principal, ApiKeyPrincipal) else None
