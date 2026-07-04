"""Scout device-code auth client tests."""

from __future__ import annotations

import httpx
import pytest
import respx

from atlas_scout.auth import (
    DEVICE_GRANT_TYPE,
    SCOUT_CLIENT_ID,
    SCOUT_LOGIN_SCOPE,
    DeviceAuthClient,
    DeviceAuthError,
)


@pytest.mark.asyncio
@respx.mock
async def test_requests_device_code() -> None:
    """Scout starts login through Better Auth's device-code endpoint."""
    route = respx.post("https://atlas.example/api/auth/device/code").mock(
        return_value=httpx.Response(
            200,
            json={
                "device_code": "device-code",
                "user_code": "ABCD-EFGH",
                "verification_uri": "https://atlas.example/device",
                "verification_uri_complete": "https://atlas.example/device?user_code=ABCD-EFGH",
                "expires_in": 1800,
                "interval": 5,
            },
        )
    )

    code = await DeviceAuthClient().request_device_code("https://atlas.example/")

    assert code.device_code == "device-code"
    assert code.user_code == "ABCD-EFGH"
    assert code.verification_uri_complete == "https://atlas.example/device?user_code=ABCD-EFGH"
    assert route.calls[0].request.headers["Content-Type"] == "application/json"
    assert route.calls[0].request.content == (
        b'{"client_id":"atlas-scout-cli","scope":"openid profile email discovery:read '
        b'discovery:write entities:write offline_access"}'
    )


@pytest.mark.asyncio
@respx.mock
async def test_exchanges_device_code_for_session_token() -> None:
    """After browser approval, Scout receives a bearer session token."""
    route = respx.post("https://atlas.example/api/auth/device/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": "device-session-token",
                "token_type": "Bearer",
                "expires_in": 3600,
                "scope": SCOUT_LOGIN_SCOPE,
            },
        )
    )

    token = await DeviceAuthClient().request_device_token(
        "https://atlas.example",
        device_code="device-code",
    )

    assert token.access_token == "device-session-token"
    assert (
        route.calls[0].request.content
        == (
            f'{{"grant_type":"{DEVICE_GRANT_TYPE}","device_code":"device-code",'
            f'"client_id":"{SCOUT_CLIENT_ID}"}}'
        ).encode()
    )


@pytest.mark.asyncio
@respx.mock
async def test_surfaces_pending_device_token_error() -> None:
    """Pending device authorization stays distinguishable for CLI polling."""
    respx.post("https://atlas.example/api/auth/device/token").mock(
        return_value=httpx.Response(
            400,
            json={
                "error": "authorization_pending",
                "error_description": "Authorization pending",
            },
        )
    )

    with pytest.raises(DeviceAuthError) as exc_info:
        await DeviceAuthClient().request_device_token(
            "https://atlas.example",
            device_code="device-code",
        )

    assert exc_info.value.error == "authorization_pending"


@pytest.mark.asyncio
@respx.mock
async def test_exchanges_session_for_api_token() -> None:
    """Scout converts its device session into a JWT the API accepts."""
    route = respx.post("https://atlas.example/api/auth/scout/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "token": "api-jwt",
                "worker_id": "worker-123",
                "user": {"id": "user-123", "email": "user@example.org"},
                "workspace_id": "org-123",
            },
        )
    )

    exchange = await DeviceAuthClient().exchange_session_for_api_token(
        "https://atlas.example",
        session_token="device-session-token",
        worker_id="worker-123",
        worker_name="Scout Laptop",
        default_upload_target="workspace",
        workspace_id="org-123",
        search_key_configured=True,
    )

    assert exchange.token == "api-jwt"
    assert exchange.worker_id == "worker-123"
    assert exchange.user_id == "user-123"
    assert exchange.user_email == "user@example.org"
    assert exchange.workspace_id == "org-123"
    assert route.calls[0].request.headers["Authorization"] == "Bearer device-session-token"
    assert route.calls[0].request.content == (
        b'{"default_upload_target":"workspace","search_key_configured":true,'
        b'"worker_id":"worker-123","worker_name":"Scout Laptop","workspace_id":"org-123"}'
    )
