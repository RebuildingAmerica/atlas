"""Authentication and authorization tests."""

from http import HTTPStatus

import pytest

from atlas.domains.access import ApiKeyPrincipal
from atlas.platform.config import Settings


@pytest.mark.asyncio
async def test_protected_discovery_requires_auth_when_enabled(
    test_client: object,
    test_settings: Settings,
) -> None:
    """Protected endpoints should reject anonymous access when auth is enabled."""
    test_settings.deploy_mode = ""
    test_settings.auth_internal_secret = "internal-test-secret"
    test_settings.auth_api_key_introspection_url = "http://auth.test/internal/api-keys/introspect"
    test_settings.auth_jwt_audience = ["https://atlas.example/api"]

    response = await test_client.post(
        "/api/discovery-runs",
        json={
            "location_query": "Gary, IN",
            "state": "IN",
            "issue_areas": ["housing_affordability"],
        },
    )

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    challenge = response.headers.get("WWW-Authenticate", "")
    assert challenge.startswith("Bearer "), (
        "RFC 6750 §3 requires a Bearer challenge on 401, including resource_metadata."
    )
    assert "https://atlas.example/api/.well-known/oauth-protected-resource" in challenge, (
        "MCP authorization spec requires the resource-metadata pointer in the challenge."
    )
    assert 'scope="discovery:read"' in challenge, (
        "MCP authorization spec §'Scope Selection Strategy' requires a default scope hint "
        "in the challenge so clients can request the smallest viable token."
    )


@pytest.mark.asyncio
async def test_protected_discovery_allows_local_mode_without_auth(
    test_client: object,
    test_settings: Settings,
) -> None:
    """Local mode should bypass auth and behave like a single-user system."""
    test_settings.deploy_mode = "local"

    response = await test_client.post(
        "/api/discovery-runs",
        json={
            "location_query": "Gary, IN",
            "state": "IN",
            "issue_areas": ["housing_affordability"],
        },
    )

    assert response.status_code == HTTPStatus.ACCEPTED


@pytest.mark.asyncio
async def test_protected_discovery_accepts_internal_actor_headers(
    test_client: object,
    test_settings: Settings,
) -> None:
    """The app server should be able to call protected API routes with trusted headers."""
    test_settings.deploy_mode = ""
    test_settings.auth_internal_secret = "internal-test-secret"

    response = await test_client.post(
        "/api/discovery-runs",
        headers={
            "X-Atlas-Internal-Secret": "internal-test-secret",
            "X-Atlas-Actor-Id": "user_123",
            "X-Atlas-Actor-Email": "operator@example.com",
            "X-Atlas-Organization-Id": "org_123",
        },
        json={
            "location_query": "Gary, IN",
            "state": "IN",
            "issue_areas": ["housing_affordability"],
        },
    )

    assert response.status_code == HTTPStatus.ACCEPTED


@pytest.mark.asyncio
async def test_protected_discovery_accepts_valid_api_key(
    monkeypatch: pytest.MonkeyPatch,
    test_client: object,
    test_settings: Settings,
) -> None:
    """Direct API clients should be able to use API keys when auth is enabled."""

    test_settings.deploy_mode = ""
    test_settings.auth_internal_secret = "internal-test-secret"
    test_settings.auth_api_key_introspection_url = "http://auth.test/internal/api-keys/introspect"

    async def fake_verify_api_key(api_key: str, settings: Settings) -> ApiKeyPrincipal | None:
        assert api_key == "atlas_test_key"
        assert (
            settings.auth_api_key_introspection_url
            == "http://auth.test/internal/api-keys/introspect"
        )
        return ApiKeyPrincipal(
            key_id="key_123",
            name="Test Key",
            permissions={"discovery": ["write"]},
            user_id="user_123",
            user_email="operator@example.com",
            org_id="org_123",
        )

    monkeypatch.setattr("atlas.domains.access.dependencies.verify_api_key", fake_verify_api_key)

    response = await test_client.post(
        "/api/discovery-runs",
        headers={"X-API-Key": "atlas_test_key"},
        json={
            "location_query": "Gary, IN",
            "state": "IN",
            "issue_areas": ["housing_affordability"],
        },
    )

    assert response.status_code == HTTPStatus.ACCEPTED


@pytest.mark.asyncio
async def test_discovery_read_requires_matching_api_key_scope(
    monkeypatch: pytest.MonkeyPatch,
    test_client: object,
    test_settings: Settings,
) -> None:
    """Discovery reads should reject API keys that only have write access."""
    test_settings.deploy_mode = ""
    test_settings.auth_internal_secret = "internal-test-secret"
    test_settings.auth_api_key_introspection_url = "http://auth.test/internal/api-keys/introspect"

    async def fake_verify_api_key(api_key: str, settings: Settings) -> ApiKeyPrincipal | None:
        assert api_key == "atlas_test_key"
        assert (
            settings.auth_api_key_introspection_url
            == "http://auth.test/internal/api-keys/introspect"
        )
        return ApiKeyPrincipal(
            key_id="key_123",
            name="Test Key",
            permissions={"discovery": ["write"]},
            user_id="user_123",
            user_email="operator@example.com",
        )

    monkeypatch.setattr("atlas.domains.access.dependencies.verify_api_key", fake_verify_api_key)

    response = await test_client.get(
        "/api/discovery-runs",
        headers={"X-API-Key": "atlas_test_key"},
    )

    assert response.status_code == HTTPStatus.FORBIDDEN


@pytest.mark.asyncio
async def test_oauth_jwt_insufficient_scope_emits_step_up_challenge(
    monkeypatch: pytest.MonkeyPatch,
    test_client: object,
    test_settings: Settings,
) -> None:
    """OAuth tokens missing a required scope must trigger the spec's step-up flow."""
    test_settings.deploy_mode = ""
    test_settings.auth_internal_secret = "internal-test-secret"
    test_settings.auth_jwt_audience = ["https://atlas.example/api"]
    test_settings.auth_jwt_issuer = "https://atlas.example/api/auth"

    def fake_verify_bearer_jwt(
        authorization: str | None,
        *,
        issuer: str,
        audience: list[str],
        jwks_url: str,
    ) -> dict[str, object]:
        del issuer, audience, jwks_url
        assert authorization == "Bearer scoped-token"
        return {
            "sub": "user_123",
            "email": "operator@example.com",
            "permissions": {"discovery": ["read"]},
        }

    monkeypatch.setattr(
        "atlas.domains.access.dependencies.verify_bearer_jwt",
        fake_verify_bearer_jwt,
    )

    response = await test_client.post(
        "/api/discovery-runs",
        headers={"Authorization": "Bearer scoped-token"},
        json={
            "location_query": "Gary, IN",
            "state": "IN",
            "issue_areas": ["housing_affordability"],
        },
    )

    assert response.status_code == HTTPStatus.FORBIDDEN
    challenge = response.headers.get("WWW-Authenticate", "")
    assert challenge.startswith("Bearer "), (
        "MCP authorization spec §'Scope Challenge Handling' requires a Bearer "
        "challenge on insufficient_scope responses."
    )
    assert 'error="insufficient_scope"' in challenge, (
        "The 403 must surface error=insufficient_scope so MCP clients can run step-up."
    )
    assert 'scope="discovery:write"' in challenge, (
        "The challenge must advertise the scope required to satisfy the request."
    )
    assert "https://atlas.example/api/.well-known/oauth-protected-resource" in challenge, (
        "The challenge must point at the protected-resource metadata document."
    )


@pytest.mark.asyncio
async def test_entity_mutation_requires_matching_api_key_scope(
    monkeypatch: pytest.MonkeyPatch,
    test_client: object,
    test_settings: Settings,
) -> None:
    """Entity mutations should reject API keys without entity write access."""
    test_settings.deploy_mode = ""
    test_settings.auth_internal_secret = "internal-test-secret"
    test_settings.auth_api_key_introspection_url = "http://auth.test/internal/api-keys/introspect"

    async def fake_verify_api_key(api_key: str, settings: Settings) -> ApiKeyPrincipal | None:
        assert api_key == "atlas_test_key"
        assert (
            settings.auth_api_key_introspection_url
            == "http://auth.test/internal/api-keys/introspect"
        )
        return ApiKeyPrincipal(
            key_id="key_123",
            name="Test Key",
            permissions={"discovery": ["read", "write"]},
            user_id="user_123",
            user_email="operator@example.com",
        )

    monkeypatch.setattr("atlas.domains.access.dependencies.verify_api_key", fake_verify_api_key)

    response = await test_client.post(
        "/api/entities",
        headers={"X-API-Key": "atlas_test_key"},
        json={
            "type": "organization",
            "name": "New Entity",
            "issue_areas": ["housing_affordability"],
        },
    )

    assert response.status_code == HTTPStatus.FORBIDDEN
