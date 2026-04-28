"""Authorization helpers for authenticated actors."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import HTTPException, status

from .challenges import build_bearer_challenge

if TYPE_CHECKING:
    from atlas.platform.config import Settings

    from .principals import AuthenticatedActor


def has_permission(actor: AuthenticatedActor, resource: str, action: str) -> bool:
    """Return whether the actor has the requested permission."""
    if actor.auth_type not in ("api_key", "oauth_jwt"):
        return True
    if not actor.permissions:
        return False
    return action in actor.permissions.get(resource, [])


def require_permission(
    actor: AuthenticatedActor,
    resource: str,
    action: str,
    *,
    settings: Settings | None = None,
) -> AuthenticatedActor:
    """Raise when the actor lacks the requested permission.

    OAuth-authenticated actors get an MCP authorization spec compliant
    ``insufficient_scope`` challenge so MCP clients can drive the step-up
    authorization flow described in §"Scope Challenge Handling".  API-key
    actors and other principals see the same 403 status without the
    ``WWW-Authenticate`` payload (OAuth flow is not applicable to them).
    """
    if has_permission(actor, resource, action):
        return actor

    headers: dict[str, str] | None = None
    if actor.auth_type == "oauth_jwt" and settings is not None:
        required_scope = f"{resource}:{action}"
        headers = {
            "WWW-Authenticate": build_bearer_challenge(
                settings,
                scope=[required_scope],
                error="insufficient_scope",
                error_description=f"This request requires the {required_scope!r} scope.",
            ),
        }

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Insufficient API key permissions",
        headers=headers,
    )
