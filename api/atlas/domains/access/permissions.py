"""Authorization helpers for authenticated actors."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import HTTPException, status

if TYPE_CHECKING:
    from .principals import AuthenticatedActor


def has_permission(actor: AuthenticatedActor, resource: str, action: str) -> bool:
    """Return whether the actor has the requested permission."""
    if actor.auth_type not in ("api_key", "oauth_jwt"):
        return True
    if not actor.permissions:
        return False
    return action in actor.permissions.get(resource, [])


def require_permission(actor: AuthenticatedActor, resource: str, action: str) -> AuthenticatedActor:
    """Raise when the actor lacks the requested permission."""
    if not has_permission(actor, resource, action):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient API key permissions",
        )
    return actor
