"""Request-state helpers shared by auth middleware and dependencies."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .principals import ApiKeyPrincipal

if TYPE_CHECKING:
    from fastapi import Request

API_KEY_PRINCIPAL_STATE_KEY = "_atlas_api_key_principal"


def api_key_principal_from_state(request: Request) -> ApiKeyPrincipal | None:
    """Return the API-key principal already verified for this request."""
    state = getattr(request, "state", None)
    if state is None:
        return None
    principal = getattr(state, API_KEY_PRINCIPAL_STATE_KEY, None)
    return principal if isinstance(principal, ApiKeyPrincipal) else None
