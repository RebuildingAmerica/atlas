"""Internal actor and permission helpers."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from atlas.domains.access.internal import build_local_actor
from atlas.domains.access.permissions import has_permission, require_permission
from atlas.domains.access.principals import AuthenticatedActor


def test_single_user_mode_runs_as_the_local_actor() -> None:
    actor = build_local_actor()

    assert actor.is_local is True
    assert actor.auth_type == "local"
    assert actor.org_id == "local"


def test_permission_helpers_enforce_api_key_and_jwt_scopes() -> None:
    """Permission helpers should pass through locals and reject missing scoped access."""
    local_actor = AuthenticatedActor(
        user_id="local",
        email="local@atlas.test",
        auth_type="local",
        is_local=True,
    )
    assert has_permission(local_actor, "entities", "write") is True

    api_key_actor = AuthenticatedActor(
        user_id="user_123",
        email="operator@example.com",
        auth_type="api_key",
        permissions={"discovery": ["read"]},
    )
    assert has_permission(api_key_actor, "entities", "write") is False
    with pytest.raises(HTTPException, match="Insufficient API key permissions"):
        require_permission(api_key_actor, "entities", "write")

    jwt_actor_without_permissions = AuthenticatedActor(
        user_id="user_456",
        email="jwt@example.com",
        auth_type="oauth_jwt",
        permissions=None,
    )
    assert has_permission(jwt_actor_without_permissions, "discovery", "read") is False
    with pytest.raises(HTTPException, match="Insufficient API key permissions"):
        require_permission(jwt_actor_without_permissions, "discovery", "read")
