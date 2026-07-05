"""Scout login command error and browser behavior tests."""

from __future__ import annotations

import httpx
import pytest
from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.auth import (
    DeviceAuthClient,
    DeviceAuthError,
    DeviceCode,
    DeviceToken,
    ScoutSession,
    ScoutTokenExchange,
)
from atlas_scout.cli import main


def _code() -> DeviceCode:
    return DeviceCode(
        device_code="device-code",
        user_code="ABCD-EFGH",
        verification_uri="https://atlas.example/device",
        verification_uri_complete="https://atlas.example/device?user_code=ABCD-EFGH",
        expires_in=1800,
        interval=5,
    )


def _token() -> DeviceToken:
    return DeviceToken(
        access_token="device-session-token",
        token_type="Bearer",
        expires_in=3600,
        scope="openid profile email",
    )


class BrowserLoginClient:
    async def request_device_code(self, atlas_url: str) -> DeviceCode:
        assert atlas_url == "https://atlas.example"
        return _code()

    async def request_device_token(self, atlas_url: str, *, device_code: str) -> DeviceToken:
        assert atlas_url == "https://atlas.example"
        assert device_code == "device-code"
        return _token()

    async def exchange_session_for_api_token(
        self,
        atlas_url: str,
        *,
        session_token: str,
        worker_name: str,
        default_upload_target: str,
        worker_id: str | None = None,
        workspace_id: str | None = None,
        search_key_configured: bool = False,
    ) -> ScoutTokenExchange:
        assert atlas_url == "https://atlas.example"
        assert session_token == "device-session-token"
        assert worker_name
        assert default_upload_target in ("public", "workspace")
        assert worker_id is None
        assert workspace_id is None
        assert search_key_configured is False
        return ScoutTokenExchange(
            token="api-jwt",
            worker_id="worker-123",
            user_id="user-123",
            user_email="user@example.org",
        )


def test_login_opens_browser_for_approval(monkeypatch) -> None:
    """Browser login opens the prefilled Atlas approval link."""
    opened: list[str] = []
    saved: list[ScoutSession] = []
    monkeypatch.setattr(cli_module, "DeviceAuthClient", BrowserLoginClient)
    monkeypatch.setattr(cli_module, "save_session", saved.append)
    monkeypatch.setattr(cli_module.webbrowser, "open", lambda url: opened.append(url) or True)

    result = CliRunner().invoke(
        main,
        [
            "login",
            "--atlas-url",
            "https://atlas.example",
            "--target",
            "public",
        ],
    )

    assert result.exit_code == 0
    assert opened == ["https://atlas.example/device?user_code=ABCD-EFGH"]
    assert saved[0].default_upload_target == "public"


def test_login_surfaces_device_code_request_error(monkeypatch) -> None:
    """Login fails clearly when Atlas cannot start device authorization."""

    class FailingDeviceCodeClient:
        async def request_device_code(self, atlas_url: str) -> DeviceCode:
            assert atlas_url == "https://atlas.example"
            raise DeviceAuthError(error="server_error", description="Atlas unavailable")

    monkeypatch.setattr(cli_module, "DeviceAuthClient", FailingDeviceCodeClient)

    result = CliRunner().invoke(
        main,
        [
            "login",
            "--atlas-url",
            "https://atlas.example",
            "--target",
            "public",
            "--no-browser",
        ],
    )

    assert result.exit_code != 0
    assert "Login failed: Atlas unavailable" in result.output


def test_device_auth_empty_http_error_names_status_and_endpoint() -> None:
    """Empty Atlas auth errors keep status and endpoint separate from presentation."""
    response = httpx.Response(
        404,
        content=b"",
        request=httpx.Request("POST", "https://atlas.example/api/auth/device/code"),
    )

    with pytest.raises(DeviceAuthError) as exc_info:
        DeviceAuthClient()._json_or_error(response)

    assert exc_info.value.error == "http_404"
    assert exc_info.value.description == ""
    assert exc_info.value.status_code == 404
    assert exc_info.value.url == "https://atlas.example/api/auth/device/code"


def test_login_surfaces_token_exchange_error(monkeypatch) -> None:
    """Login fails clearly when browser approval cannot mint an API token."""
    saved: list[ScoutSession] = []

    class FailingTokenExchangeClient(BrowserLoginClient):
        async def exchange_session_for_api_token(
            self,
            atlas_url: str,
            *,
            session_token: str,
            worker_name: str,
            default_upload_target: str,
            worker_id: str | None = None,
            workspace_id: str | None = None,
            search_key_configured: bool = False,
        ) -> ScoutTokenExchange:
            assert atlas_url == "https://atlas.example"
            assert session_token == "device-session-token"
            assert worker_name
            assert default_upload_target == "public"
            assert worker_id is None
            assert workspace_id is None
            assert search_key_configured is False
            raise DeviceAuthError(error="server_error", description="Token exchange failed")

    monkeypatch.setattr(cli_module, "DeviceAuthClient", FailingTokenExchangeClient)
    monkeypatch.setattr(cli_module, "save_session", saved.append)

    result = CliRunner().invoke(
        main,
        [
            "login",
            "--atlas-url",
            "https://atlas.example",
            "--target",
            "public",
            "--no-browser",
        ],
    )

    assert result.exit_code != 0
    assert saved == []
    assert "Login failed: Token exchange failed" in result.output
