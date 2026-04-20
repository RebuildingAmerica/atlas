"""Tests for require_org_actor and require_org_role dependencies."""

from __future__ import annotations

from http import HTTPStatus
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from atlas.domains.access.dependencies import require_org_actor, require_org_role
from atlas.domains.access.membership import MembershipResult
from atlas.domains.access.principals import AuthenticatedActor
from atlas.platform.config import Settings


def _make_settings(
    membership_url: str = "http://localhost:3000",
    secret: str = "test-secret",
) -> MagicMock:
    settings = MagicMock(spec=Settings)
    settings.auth_membership_verification_url = membership_url
    settings.auth_internal_secret = secret
    return settings


def _make_actor(
    user_id: str = "user_1",
    org_id: str | None = "org_1",
    org_role: str | None = None,
) -> AuthenticatedActor:
    return AuthenticatedActor(
        user_id=user_id,
        email="test@example.com",
        auth_type="oauth_jwt",
        org_id=org_id,
        org_role=org_role,
    )


async def test_require_org_actor_raises_403_when_org_id_is_none() -> None:
    """Should raise 403 when actor.org_id is None."""
    actor = _make_actor(org_id=None)
    settings = _make_settings()

    with pytest.raises(HTTPException) as exc_info:
        await require_org_actor(actor=actor, settings=settings)

    assert exc_info.value.status_code == HTTPStatus.FORBIDDEN
    assert "Organization context required" in exc_info.value.detail


async def test_require_org_actor_returns_actor_when_membership_url_empty() -> None:
    """Dev mode bypass: when membership URL is empty, trust org_id from the token."""
    actor = _make_actor(org_id="org_dev")
    settings = _make_settings(membership_url="")

    result = await require_org_actor(actor=actor, settings=settings)

    assert result is actor
    assert result.org_id == "org_dev"


async def test_require_org_actor_raises_403_when_verification_returns_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Should raise 403 when membership verification returns None (not a member)."""
    actor = _make_actor(org_id="org_unknown")
    settings = _make_settings()

    async def fake_verify(
        _user_id: str, _org_id: str, _settings_arg: object
    ) -> MembershipResult | None:
        return None

    monkeypatch.setattr(
        "atlas.domains.access.dependencies.verify_org_membership",
        fake_verify,
    )

    with pytest.raises(HTTPException) as exc_info:
        await require_org_actor(actor=actor, settings=settings)

    assert exc_info.value.status_code == HTTPStatus.FORBIDDEN
    assert "Not a member" in exc_info.value.detail


async def test_require_org_actor_populates_org_fields_on_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Should populate org_role, org_slug, workspace_type when verification succeeds."""
    actor = _make_actor(org_id="org_verified")
    settings = _make_settings()

    async def fake_verify(_user_id: str, _org_id: str, _settings_arg: object) -> MembershipResult:
        return MembershipResult(
            role="admin",
            slug="verified-org",
            name="Verified Org",
            workspace_type="team",
        )

    monkeypatch.setattr(
        "atlas.domains.access.dependencies.verify_org_membership",
        fake_verify,
    )

    result = await require_org_actor(actor=actor, settings=settings)

    assert result.org_role == "admin"
    assert result.org_slug == "verified-org"
    assert result.workspace_type == "team"


async def test_require_org_role_admin_raises_403_for_member_role() -> None:
    """require_org_role('admin') should raise 403 for a member-level actor."""
    actor = _make_actor(org_id="org_1", org_role="member")
    dependency = require_org_role("admin")

    with pytest.raises(HTTPException) as exc_info:
        await dependency(actor=actor)

    assert exc_info.value.status_code == HTTPStatus.FORBIDDEN
    assert "admin" in exc_info.value.detail


async def test_require_org_role_admin_passes_for_admin_and_owner() -> None:
    """require_org_role('admin') should pass for admin and owner roles."""
    dependency = require_org_role("admin")

    admin_actor = _make_actor(org_id="org_1", org_role="admin")
    result = await dependency(actor=admin_actor)
    assert result is admin_actor

    owner_actor = _make_actor(org_id="org_1", org_role="owner")
    result = await dependency(actor=owner_actor)
    assert result is owner_actor
