"""The actor single-user mode runs as."""

from __future__ import annotations

from .principals import AuthenticatedActor


def build_local_actor() -> AuthenticatedActor:
    """Return the implicit local-mode actor."""
    return AuthenticatedActor(
        user_id="local-operator",
        email="local@atlas.rebuildingus.org",
        auth_type="local",
        is_local=True,
        org_id="local",
    )
