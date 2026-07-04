"""Scout device auth response validation tests."""

from __future__ import annotations

import httpx
import pytest
import respx

from atlas_scout.auth import DeviceAuthClient, DeviceAuthError


@pytest.mark.asyncio
@respx.mock
async def test_rejects_invalid_integer_payload() -> None:
    """Device-code metadata must use integer-compatible expiry fields."""
    respx.post("https://atlas.example/api/auth/device/code").mock(
        return_value=httpx.Response(
            200,
            json={
                "device_code": "device-code",
                "user_code": "ABCD-EFGH",
                "verification_uri": "https://atlas.example/device",
                "verification_uri_complete": "https://atlas.example/device?user_code=ABCD-EFGH",
                "expires_in": {"seconds": 1800},
                "interval": 5,
            },
        )
    )

    with pytest.raises(DeviceAuthError) as exc_info:
        await DeviceAuthClient().request_device_code("https://atlas.example")

    assert exc_info.value.error == "invalid_response"


@pytest.mark.asyncio
@respx.mock
async def test_surfaces_non_json_error_response() -> None:
    """HTTP errors without OAuth JSON still produce a useful auth error."""
    respx.post("https://atlas.example/api/auth/device/token").mock(
        return_value=httpx.Response(502, text="bad gateway")
    )

    with pytest.raises(DeviceAuthError) as exc_info:
        await DeviceAuthClient().request_device_token(
            "https://atlas.example",
            device_code="device-code",
        )

    assert exc_info.value.error == "http_502"
    assert exc_info.value.description == "bad gateway"


@pytest.mark.asyncio
@respx.mock
async def test_rejects_non_object_json_response() -> None:
    """Successful auth responses must be JSON objects."""
    respx.post("https://atlas.example/api/auth/device/token").mock(
        return_value=httpx.Response(200, json=["not", "an", "object"])
    )

    with pytest.raises(ValueError, match="JSON object"):
        await DeviceAuthClient().request_device_token(
            "https://atlas.example",
            device_code="device-code",
        )
