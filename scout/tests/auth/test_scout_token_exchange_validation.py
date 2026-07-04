"""Scout API token exchange validation tests."""

from __future__ import annotations

import httpx
import pytest
import respx

from atlas_scout.auth import DeviceAuthClient, DeviceAuthError


@pytest.mark.asyncio
@respx.mock
async def test_requires_user_metadata() -> None:
    """The API-token bridge must return the user behind the worker session."""
    respx.post("https://atlas.example/api/auth/scout/token").mock(
        return_value=httpx.Response(200, json={"token": "api-jwt"})
    )

    with pytest.raises(ValueError, match="missing user metadata"):
        await DeviceAuthClient().exchange_session_for_api_token(
            "https://atlas.example",
            session_token="device-session-token",
            worker_name="Scout Laptop",
            default_upload_target="workspace",
        )


@pytest.mark.asyncio
@respx.mock
async def test_requires_string_workspace_id() -> None:
    """Workspace identity must stay an explicit string when present."""
    respx.post("https://atlas.example/api/auth/scout/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "token": "api-jwt",
                "worker_id": "worker-123",
                "user": {"id": "user-123", "email": "user@example.org"},
                "workspace_id": 123,
            },
        )
    )

    with pytest.raises(ValueError, match="workspace_id must be a string"):
        await DeviceAuthClient().exchange_session_for_api_token(
            "https://atlas.example",
            session_token="device-session-token",
            worker_name="Scout Laptop",
            default_upload_target="workspace",
        )


@pytest.mark.asyncio
@respx.mock
async def test_requires_string_worker_id() -> None:
    """The bridge must return the enrolled device id Scout should remember."""
    respx.post("https://atlas.example/api/auth/scout/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "token": "api-jwt",
                "worker_id": 123,
                "user": {"id": "user-123", "email": "user@example.org"},
                "workspace_id": "org-123",
            },
        )
    )

    with pytest.raises(DeviceAuthError, match="invalid worker_id"):
        await DeviceAuthClient().exchange_session_for_api_token(
            "https://atlas.example",
            session_token="device-session-token",
            worker_name="Scout Laptop",
            default_upload_target="workspace",
        )
