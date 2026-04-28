"""Unit tests for the Bearer challenge builder."""

from __future__ import annotations

import pytest

from atlas.domains.access.challenges import build_bearer_challenge
from atlas.platform.config import Settings


@pytest.fixture
def auth_settings() -> Settings:
    """Return Settings configured with audience and default scope set."""
    settings = Settings()
    settings.auth_jwt_audience = ["https://atlas.example/api"]
    settings.auth_jwt_default_scope = ["discovery:read"]
    return settings


def test_build_bearer_challenge_includes_resource_metadata_and_scope(
    auth_settings: Settings,
) -> None:
    """The 401 challenge must point clients at the PRM doc and hint at scope."""
    challenge = build_bearer_challenge(auth_settings)

    assert challenge.startswith("Bearer ")
    assert (
        'resource_metadata="https://atlas.example/api/.well-known/oauth-protected-resource"'
        in challenge
    )
    assert 'scope="discovery:read"' in challenge


def test_build_bearer_challenge_joins_multiple_scopes_with_space(
    auth_settings: Settings,
) -> None:
    """RFC 6750 §3 requires space-delimited scope tokens inside one quoted string."""
    auth_settings.auth_jwt_default_scope = ["discovery:read", "entities:write"]

    challenge = build_bearer_challenge(auth_settings)

    assert 'scope="discovery:read entities:write"' in challenge


def test_build_bearer_challenge_omits_scope_when_default_empty(auth_settings: Settings) -> None:
    """No scope hint should be emitted when no default scope is configured."""
    auth_settings.auth_jwt_default_scope = []

    challenge = build_bearer_challenge(auth_settings)

    assert "scope=" not in challenge
    assert "resource_metadata=" in challenge


def test_build_bearer_challenge_includes_error_for_insufficient_scope(
    auth_settings: Settings,
) -> None:
    """403 challenges must carry error="insufficient_scope" with the required scopes."""
    challenge = build_bearer_challenge(
        auth_settings,
        scope=["entities:write"],
        error="insufficient_scope",
        error_description="Entity write permission required",
    )

    assert 'error="insufficient_scope"' in challenge
    assert 'scope="entities:write"' in challenge
    assert 'error_description="Entity write permission required"' in challenge


def test_build_bearer_challenge_skips_metadata_when_audience_unset() -> None:
    """Without audience, no resource_metadata pointer can be advertised."""
    settings = Settings()
    settings.auth_jwt_audience = []
    settings.auth_jwt_default_scope = []

    challenge = build_bearer_challenge(settings)

    assert challenge == "Bearer"


def test_build_bearer_challenge_strips_trailing_slash_from_resource_url(
    auth_settings: Settings,
) -> None:
    """The resource_metadata URL should not produce a doubled `//` separator."""
    auth_settings.auth_jwt_audience = ["https://atlas.example/api/"]

    challenge = build_bearer_challenge(auth_settings)

    assert (
        'resource_metadata="https://atlas.example/api/.well-known/oauth-protected-resource"'
        in challenge
    )
