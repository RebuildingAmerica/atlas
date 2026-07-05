"""Scout auth client HTTP error sanitization tests."""

from __future__ import annotations

import httpx
import pytest

from atlas_scout.auth import DeviceAuthClient, DeviceAuthError


def test_html_http_error_is_structured_without_body() -> None:
    """HTML auth failures must not leak page markup into CLI-facing errors."""
    response = httpx.Response(
        405,
        headers={"content-type": "text/html; charset=utf-8"},
        text="<!DOCTYPE html><html><body>Method Not Allowed</body></html>",
        request=httpx.Request("POST", "https://atlas.localhost/api/auth/device/code"),
    )

    with pytest.raises(DeviceAuthError) as exc_info:
        DeviceAuthClient()._json_or_error(response)

    error = exc_info.value
    assert error.error == "http_405"
    assert error.status_code == 405
    assert error.url == "https://atlas.localhost/api/auth/device/code"
    assert error.content_type == "text/html; charset=utf-8"
    assert "<html" not in error.description
    assert "Method Not Allowed" not in error.description
