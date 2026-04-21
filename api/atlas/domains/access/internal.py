"""Trusted internal auth helpers."""

from __future__ import annotations

from secrets import compare_digest
from typing import TYPE_CHECKING

from fastapi import HTTPException, status

from .principals import AuthenticatedActor

if TYPE_CHECKING:
    from atlas.platform.config import Settings


def build_local_actor() -> AuthenticatedActor:
    """Return the implicit local-mode actor."""
    return AuthenticatedActor(
        user_id="local-operator",
        email="local@atlas.example.com",
        auth_type="local",
        is_local=True,
        org_id="local",
    )


def verify_internal_actor(
    settings: Settings,
    internal_secret: str | None,
    actor_id: str | None,
    actor_email: str | None,
    org_id: str | None = None,
) -> AuthenticatedActor | None:
    """Validate trusted app-to-API headers."""
    if not (
        settings.auth_internal_secret
        and internal_secret
        and compare_digest(internal_secret, settings.auth_internal_secret)
    ):
        return None

    if not actor_id or not actor_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Trusted requests must include actor identity headers",
        )

    return AuthenticatedActor(
        user_id=actor_id,
        email=actor_email,
        auth_type="internal",
        org_id=org_id,
    )
