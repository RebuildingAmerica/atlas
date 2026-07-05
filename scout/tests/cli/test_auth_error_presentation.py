"""Scout auth error presentation tests."""

from __future__ import annotations

from atlas_scout.auth import DeviceAuthError
from atlas_scout.cli_output import format_device_auth_error


def test_html_http_error_renders_concise_url_guidance() -> None:
    """Auth HTTP failures should be readable without local-dev assumptions."""
    message = format_device_auth_error(
        DeviceAuthError(
            error="http_405",
            description="",
            status_code=405,
            url="https://atlas.example/device/code",
            content_type="text/html; charset=utf-8",
        )
    )

    assert "HTTP 405" in message
    assert "https://atlas.example/device/code" in message
    assert "https://atlas.localhost" not in message
    assert "pnpm dev" not in message
    assert "<html" not in message
    assert "Method Not Allowed" not in message


def test_plain_auth_error_uses_server_description() -> None:
    """OAuth JSON descriptions are already intentional user-facing auth copy."""
    message = format_device_auth_error(
        DeviceAuthError(error="server_error", description="Atlas unavailable")
    )

    assert message == "Atlas unavailable"


def test_generic_server_http_error_message_is_not_repeated() -> None:
    """Generic server exception names should not become the whole login error."""
    message = format_device_auth_error(
        DeviceAuthError(
            error="http_500",
            description="HTTPError",
            status_code=500,
            url="https://atlas.localhost/device/code",
            content_type="application/json;charset=UTF-8",
        )
    )

    assert "HTTP 500" in message
    assert "https://atlas.localhost/device/code" in message
    assert message != "HTTPError"
