"""API-key runtime helpers."""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx
import pytest

from atlas.domains.access.api_keys import verify_api_key

from .support import _async_client_factory

if TYPE_CHECKING:
    from atlas.platform.config import Settings

pytestmark = pytest.mark.asyncio


async def test_verify_api_key_returns_none_without_introspection_settings(
    test_settings: Settings,
) -> None:
    """API-key auth should be disabled when required runtime config is missing."""
    test_settings.auth_api_key_introspection_url = None
    test_settings.auth_internal_secret = ""

    assert await verify_api_key("atlas_test_key", test_settings) is None


async def test_verify_api_key_handles_success_and_rejected_tokens(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Introspection should accept valid keys and reject invalid ones cleanly."""
    test_settings.auth_api_key_introspection_url = "https://auth.example.test/introspect"
    test_settings.auth_internal_secret = "internal-test-secret"

    success_response = httpx.Response(
        200,
        json={
            "valid": True,
            "keyId": "key_123",
            "name": "Atlas CLI",
            "permissions": {"discovery": ["read"]},
            "userId": "user_123",
            "userEmail": "operator@example.com",
        },
        request=httpx.Request("POST", test_settings.auth_api_key_introspection_url),
    )
    monkeypatch.setattr(
        "atlas.domains.access.api_keys.httpx.AsyncClient",
        _async_client_factory(success_response),
    )

    principal = await verify_api_key("atlas_test_key", test_settings)

    assert principal is not None
    assert principal.key_id == "key_123"
    assert principal.permissions == {"discovery": ["read"]}

    invalid_response = httpx.Response(
        200,
        json={"valid": False},
        request=httpx.Request("POST", test_settings.auth_api_key_introspection_url),
    )
    monkeypatch.setattr(
        "atlas.domains.access.api_keys.httpx.AsyncClient",
        _async_client_factory(invalid_response),
    )

    assert await verify_api_key("atlas_test_key", test_settings) is None


async def test_verify_api_key_treats_not_found_and_unauthorized_as_invalid(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Missing or unauthorized introspection responses should behave like invalid keys."""
    test_settings.auth_api_key_introspection_url = "https://auth.example.test/introspect"
    test_settings.auth_internal_secret = "internal-test-secret"

    for status_code in (401, 404):
        response = httpx.Response(
            status_code,
            request=httpx.Request("POST", test_settings.auth_api_key_introspection_url),
        )
        monkeypatch.setattr(
            "atlas.domains.access.api_keys.httpx.AsyncClient",
            _async_client_factory(response),
        )
        assert await verify_api_key("atlas_test_key", test_settings) is None


async def test_verify_api_key_raises_for_server_errors_and_transport_failures(
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Operational introspection failures should still surface upstream."""
    test_settings.auth_api_key_introspection_url = "https://auth.example.test/introspect"
    test_settings.auth_internal_secret = "internal-test-secret"

    server_error = httpx.Response(
        500,
        text="upstream boom",
        request=httpx.Request("POST", test_settings.auth_api_key_introspection_url),
    )
    monkeypatch.setattr(
        "atlas.domains.access.api_keys.httpx.AsyncClient",
        _async_client_factory(server_error),
    )
    with pytest.raises(httpx.HTTPStatusError):
        await verify_api_key("atlas_test_key", test_settings)

    monkeypatch.setattr(
        "atlas.domains.access.api_keys.httpx.AsyncClient",
        _async_client_factory(RuntimeError("network down")),
    )
    with pytest.raises(RuntimeError, match="network down"):
        await verify_api_key("atlas_test_key", test_settings)
