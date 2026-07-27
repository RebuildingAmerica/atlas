"""Firehose websocket, auth, and OpenAPI contract tests."""

from __future__ import annotations

from http import HTTPStatus

import pytest
from fastapi import WebSocketException
from fastapi.testclient import TestClient
from starlette.datastructures import Headers

from atlas.domains.access import ApiKeyPrincipal
from atlas.domains.access.models.usage_events import OrgUsageEventCRUD
from atlas.domains.firehose import api as firehose_api
from atlas.main import create_app
from atlas.platform.config import Settings, get_settings

FINGERPRINT_LENGTH = 64
DEFAULT_FIREHOSE_LIMIT = 50
FIREHOSE_WEBSOCKET_PROTOCOL = "atlas.firehose.v1"
FIREHOSE_WEBSOCKET_POLICY_VIOLATION = 1008


class _FakeWebSocket:
    """Minimal WebSocket stand-in for auth helper coverage."""

    def __init__(self, headers: dict[str, str]) -> None:
        self.headers = Headers(headers)


def test_firehose_session_socket_emits_ready_event(test_settings: Settings) -> None:
    """The WebSocket stub should expose the future bidirectional session surface."""
    test_settings.multi_user = False
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: test_settings

    with (
        TestClient(app) as client,
        client.websocket_connect(
            "/api/firehose/sessions/fhs_test/socket",
            subprotocols=[FIREHOSE_WEBSOCKET_PROTOCOL],
        ) as websocket,
    ):
        assert websocket.accepted_subprotocol == FIREHOSE_WEBSOCKET_PROTOCOL
        ready = websocket.receive_json()

    assert ready["type"] == "firehose.ready"
    assert ready["session_id"] == "fhs_test"
    assert ready["workspace"] == {
        "org_id": "local",
        "actor_id": "local-operator",
        "auth_type": "local",
        "api_key_id": None,
    }
    assert ready["usage"]["meter"] == "firehose_socket"
    assert len(ready["usage"]["query_fingerprint"]) == FINGERPRINT_LENGTH
    assert ready["query"]["limit"] == DEFAULT_FIREHOSE_LIMIT
    assert ready["last_event_id"] is None


def test_firehose_session_socket_rejects_unknown_subprotocol() -> None:
    """Firehose sockets should reject clients that request the wrong protocol."""
    websocket = _FakeWebSocket({"Sec-WebSocket-Protocol": "not-atlas-firehose"})

    with pytest.raises(WebSocketException) as exc_info:
        firehose_api._websocket_subprotocol(websocket)  # noqa: SLF001

    assert exc_info.value.code == FIREHOSE_WEBSOCKET_POLICY_VIOLATION


def test_firehose_session_socket_allows_missing_subprotocol() -> None:
    """Clients may connect without an explicit subprotocol."""
    websocket = _FakeWebSocket({})

    assert firehose_api._websocket_subprotocol(websocket) is None  # noqa: SLF001


@pytest.mark.asyncio
async def test_firehose_session_socket_accepts_internal_actor(test_settings: Settings) -> None:
    """Internal trusted callers should be able to consume workspace Firehose sockets."""
    test_settings.multi_user = True
    test_settings.auth_internal_secret = "internal-test-secret"
    websocket = _FakeWebSocket(
        {
            "X-Atlas-Internal-Secret": "internal-test-secret",
            "X-Atlas-Actor-ID": "user_123",
            "X-Atlas-Actor-Email": "operator@example.com",
            "X-Atlas-Organization-ID": "org_123",
        }
    )

    actor = await firehose_api._websocket_actor(websocket, test_settings)  # noqa: SLF001

    assert actor.org_id == "org_123"
    assert actor.user_id == "user_123"
    assert actor.auth_type == "internal"
    assert actor.api_key_id is None


@pytest.mark.asyncio
async def test_firehose_session_socket_rejects_internal_actor_without_org(
    test_settings: Settings,
) -> None:
    """Trusted Firehose socket callers must still be scoped to an organization."""
    test_settings.multi_user = True
    test_settings.auth_internal_secret = "internal-test-secret"
    websocket = _FakeWebSocket(
        {
            "X-Atlas-Internal-Secret": "internal-test-secret",
            "X-Atlas-Actor-ID": "user_123",
            "X-Atlas-Actor-Email": "operator@example.com",
        }
    )

    with pytest.raises(WebSocketException) as exc_info:
        await firehose_api._websocket_actor(websocket, test_settings)  # noqa: SLF001

    assert exc_info.value.code == FIREHOSE_WEBSOCKET_POLICY_VIOLATION


@pytest.mark.asyncio
async def test_firehose_session_socket_accepts_api_key_actor(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """API-key callers with Firehose read scope should be able to stream."""
    test_settings.multi_user = True
    test_settings.auth_api_key_introspection_url = "http://auth.test/internal/api-keys/introspect"

    async def fake_verify_api_key(api_key: str, settings: Settings) -> ApiKeyPrincipal | None:
        assert api_key == "atlas_test_key"
        assert settings.auth_api_key_introspection_url is not None
        return ApiKeyPrincipal(
            key_id="key_123",
            name="Test Key",
            permissions={"firehose": ["read"]},
            user_id="user_123",
            user_email="operator@example.com",
            org_id="org_123",
        )

    monkeypatch.setattr("atlas.domains.firehose.api.verify_api_key", fake_verify_api_key)
    websocket = _FakeWebSocket({"X-API-Key": "atlas_test_key"})

    actor = await firehose_api._websocket_actor(websocket, test_settings)  # noqa: SLF001

    assert actor.org_id == "org_123"
    assert actor.user_id == "user_123"
    assert actor.auth_type == "api_key"
    assert actor.api_key_id == "key_123"


@pytest.mark.asyncio
async def test_firehose_session_socket_rejects_unknown_api_key(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Unknown API keys should not fall through to a workspace stream."""
    test_settings.multi_user = True
    test_settings.auth_api_key_introspection_url = "http://auth.test/internal/api-keys/introspect"

    async def fake_verify_api_key(api_key: str, settings: Settings) -> None:
        assert api_key == "atlas_test_key"
        assert settings.auth_api_key_introspection_url is not None

    monkeypatch.setattr("atlas.domains.firehose.api.verify_api_key", fake_verify_api_key)
    websocket = _FakeWebSocket({"X-API-Key": "atlas_test_key"})

    with pytest.raises(WebSocketException) as exc_info:
        await firehose_api._websocket_actor(websocket, test_settings)  # noqa: SLF001

    assert exc_info.value.code == FIREHOSE_WEBSOCKET_POLICY_VIOLATION


@pytest.mark.asyncio
async def test_firehose_session_socket_rejects_api_key_without_org(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """API-key Firehose streams must be scoped to an organization."""
    test_settings.multi_user = True
    test_settings.auth_api_key_introspection_url = "http://auth.test/internal/api-keys/introspect"

    async def fake_verify_api_key(api_key: str, settings: Settings) -> ApiKeyPrincipal | None:
        assert api_key == "atlas_test_key"
        assert settings.auth_api_key_introspection_url is not None
        return ApiKeyPrincipal(
            key_id="key_123",
            name="Test Key",
            permissions={"firehose": ["read"]},
            user_id="user_123",
            user_email="operator@example.com",
            org_id=None,
        )

    monkeypatch.setattr("atlas.domains.firehose.api.verify_api_key", fake_verify_api_key)
    websocket = _FakeWebSocket({"X-API-Key": "atlas_test_key"})

    with pytest.raises(WebSocketException) as exc_info:
        await firehose_api._websocket_actor(websocket, test_settings)  # noqa: SLF001

    assert exc_info.value.code == FIREHOSE_WEBSOCKET_POLICY_VIOLATION


@pytest.mark.asyncio
async def test_firehose_session_socket_accepts_oauth_jwt_actor(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """OAuth JWT callers with Firehose read permission should be able to stream."""
    test_settings.multi_user = True
    test_settings.auth_jwt_audience = ["https://atlas.example/api"]
    test_settings.auth_jwt_issuer = "https://atlas.example/auth"
    test_settings.auth_jwt_jwks_url = "https://atlas.example/auth/jwks"

    def fake_verify_bearer_jwt(
        authorization: str | None,
        *,
        issuer: str,
        audience: list[str],
        jwks_url: str,
    ) -> dict[str, object] | None:
        assert authorization == "Bearer token_123"
        assert issuer == "https://atlas.example/auth"
        assert audience == ["https://atlas.example/api"]
        assert jwks_url == "https://atlas.example/auth/jwks"
        return {
            "sub": "user_123",
            "email": "operator@example.com",
            "org_id": "org_123",
            "permissions": {"firehose": ["read"]},
        }

    monkeypatch.setattr("atlas.domains.firehose.api.verify_bearer_jwt", fake_verify_bearer_jwt)
    websocket = _FakeWebSocket({"Authorization": "Bearer token_123"})

    actor = await firehose_api._websocket_actor(websocket, test_settings)  # noqa: SLF001

    assert actor.org_id == "org_123"
    assert actor.user_id == "user_123"
    assert actor.auth_type == "oauth_jwt"
    assert actor.api_key_id is None


@pytest.mark.asyncio
async def test_firehose_session_socket_rejects_oauth_jwt_without_org(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """OAuth Firehose streams must be scoped to an organization."""
    test_settings.multi_user = True
    test_settings.auth_jwt_audience = ["https://atlas.example/api"]
    test_settings.auth_jwt_issuer = "https://atlas.example/auth"
    test_settings.auth_jwt_jwks_url = "https://atlas.example/auth/jwks"

    def fake_verify_bearer_jwt(
        authorization: str | None,
        *,
        issuer: str,
        audience: list[str],
        jwks_url: str,
    ) -> dict[str, object] | None:
        assert authorization == "Bearer token_123"
        assert issuer == "https://atlas.example/auth"
        assert audience == ["https://atlas.example/api"]
        assert jwks_url == "https://atlas.example/auth/jwks"
        return {
            "sub": "user_123",
            "email": "operator@example.com",
            "permissions": {"firehose": ["read"]},
        }

    monkeypatch.setattr("atlas.domains.firehose.api.verify_bearer_jwt", fake_verify_bearer_jwt)
    websocket = _FakeWebSocket({"Authorization": "Bearer token_123"})

    with pytest.raises(WebSocketException) as exc_info:
        await firehose_api._websocket_actor(websocket, test_settings)  # noqa: SLF001

    assert exc_info.value.code == FIREHOSE_WEBSOCKET_POLICY_VIOLATION


@pytest.mark.asyncio
async def test_firehose_requires_firehose_read_scope_for_api_keys(
    monkeypatch: pytest.MonkeyPatch,
    test_client: object,
    test_settings: Settings,
    test_db: object,
) -> None:
    """API keys need the Firehose read scope and are counted against their workspace."""
    test_settings.multi_user = True
    test_settings.auth_internal_secret = "internal-test-secret"
    test_settings.auth_api_key_introspection_url = "http://auth.test/internal/api-keys/introspect"

    async def fake_verify_api_key(api_key: str, settings: Settings) -> ApiKeyPrincipal | None:
        assert api_key == "atlas_test_key"
        assert settings.auth_api_key_introspection_url is not None
        return ApiKeyPrincipal(
            key_id="key_123",
            name="Test Key",
            permissions={"firehose": ["read"]},
            user_id="user_123",
            user_email="operator@example.com",
            org_id="org_123",
            active_products=["atlas_team"],
        )

    monkeypatch.setattr(
        "atlas.platform.http.anonymous_rate_limit.verify_api_key",
        fake_verify_api_key,
        raising=False,
    )
    monkeypatch.setattr("atlas.domains.access.dependencies.verify_api_key", fake_verify_api_key)

    response = await test_client.get(
        "/api/firehose",
        headers={"X-API-Key": "atlas_test_key", "Accept": "application/json"},
    )

    assert response.status_code == HTTPStatus.OK
    assert response.json()["workspace"] == {
        "org_id": "org_123",
        "actor_id": "user_123",
        "auth_type": "api_key",
        "api_key_id": "key_123",
    }
    assert await OrgUsageEventCRUD.count_by_type(test_db, org_id="org_123") == {"api_call": 1}


@pytest.mark.asyncio
async def test_firehose_rejects_api_keys_without_firehose_read_scope(
    monkeypatch: pytest.MonkeyPatch,
    test_client: object,
    test_settings: Settings,
    test_db: object,
) -> None:
    """A discovery API key should not read Firehose by accident."""
    test_settings.multi_user = True
    test_settings.auth_internal_secret = "internal-test-secret"
    test_settings.auth_api_key_introspection_url = "http://auth.test/internal/api-keys/introspect"

    async def fake_verify_api_key(api_key: str, settings: Settings) -> ApiKeyPrincipal | None:
        assert api_key == "atlas_test_key"
        assert settings.auth_api_key_introspection_url is not None
        return ApiKeyPrincipal(
            key_id="key_123",
            name="Test Key",
            permissions={"discovery": ["read"]},
            user_id="user_123",
            user_email="operator@example.com",
            org_id="org_123",
        )

    monkeypatch.setattr("atlas.domains.access.dependencies.verify_api_key", fake_verify_api_key)

    response = await test_client.get(
        "/api/firehose",
        headers={"X-API-Key": "atlas_test_key", "Accept": "application/json"},
    )

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert await OrgUsageEventCRUD.count_by_type(test_db, org_id="org_123") == {}


@pytest.mark.asyncio
async def test_firehose_requires_auth_when_auth_is_enabled(
    test_client: object,
    test_settings: Settings,
) -> None:
    """Firehose is not anonymous when Atlas auth is enabled."""
    test_settings.multi_user = True
    test_settings.auth_internal_secret = "internal-test-secret"
    test_settings.auth_api_key_introspection_url = "http://auth.test/internal/api-keys/introspect"
    test_settings.auth_jwt_audience = ["https://atlas.example/api"]

    response = await test_client.get("/api/firehose", headers={"Accept": "application/json"})

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.headers["www-authenticate"].startswith("Bearer ")


@pytest.mark.asyncio
async def test_firehose_query_validation_rejects_invalid_limits(test_client: object) -> None:
    """Firehose query parameters should fail loudly when outside the contract."""
    response = await test_client.get("/api/firehose", params={"limit": "0"})

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY


@pytest.mark.asyncio
async def test_firehose_openapi_declares_query_surface(test_client: object) -> None:
    """OpenAPI should document the Firehose snapshot and session entrypoints."""
    response = await test_client.get("/openapi.json")
    payload = response.json()

    assert payload["paths"]["/api/firehose"]["get"]["operationId"] == "getFirehose"
    assert payload["paths"]["/api/firehose"]["head"]["operationId"] == "headFirehose"
    assert (
        payload["paths"]["/api/firehose/sessions"]["post"]["operationId"] == "createFirehoseSession"
    )
    assert (
        payload["paths"]["/api/firehose/sessions/{session_id}"]["get"]["operationId"]
        == "getFirehoseSession"
    )
    declared_tags = {tag["name"] for tag in payload["tags"]}
    assert "firehose" in declared_tags
