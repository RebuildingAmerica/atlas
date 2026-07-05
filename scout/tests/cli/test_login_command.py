"""Scout login command tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.auth import DeviceCode, DeviceToken, ScoutSession, ScoutTokenExchange
from atlas_scout.cli import main

if TYPE_CHECKING:
    import pytest


class FakeDeviceAuthClient:
    async def request_device_code(self, atlas_url: str) -> DeviceCode:
        assert atlas_url == "https://atlas.example"
        return DeviceCode(
            device_code="device-code",
            user_code="ABCD-EFGH",
            verification_uri="https://atlas.example/device",
            verification_uri_complete="https://atlas.example/device?user_code=ABCD-EFGH",
            expires_in=1800,
            interval=5,
        )

    async def request_device_token(self, atlas_url: str, *, device_code: str) -> DeviceToken:
        assert atlas_url == "https://atlas.example"
        assert device_code == "device-code"
        return DeviceToken(
            access_token="device-session-token",
            token_type="Bearer",
            expires_in=3600,
            scope="openid profile email",
        )

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
        assert worker_name == "Scout Laptop"
        assert default_upload_target == "workspace"
        assert worker_id is None
        assert workspace_id is None
        assert search_key_configured is False
        return ScoutTokenExchange(
            token="api-jwt",
            worker_id="worker-123",
            user_id="user-123",
            user_email="user@example.org",
            workspace_id="org-123",
        )


def test_login_saves_browser_approved_session(monkeypatch: pytest.MonkeyPatch) -> None:
    """login stores the browser-approved session and remembered upload target."""
    saved: list[ScoutSession] = []
    monkeypatch.setattr(cli_module, "DeviceAuthClient", FakeDeviceAuthClient)
    monkeypatch.setattr(cli_module, "save_session", saved.append)
    monkeypatch.setattr(cli_module.platform, "node", lambda: "Scout Laptop")
    monkeypatch.setattr(cli_module.webbrowser, "open", lambda _url: True)

    result = CliRunner().invoke(
        main,
        [
            "login",
            "--atlas-url",
            "https://atlas.example",
            "--target",
            "workspace",
            "--no-browser",
        ],
    )

    assert result.exit_code == 0
    assert saved == [
        ScoutSession(
            atlas_url="https://atlas.example",
            access_token="device-session-token",
            worker_id="worker-123",
            user_id="user-123",
            user_email="user@example.org",
            worker_name="Scout Laptop",
            default_upload_target="workspace",
            workspace_id="org-123",
        )
    ]
    assert "ABCD-EFGH" in result.output
    assert "Logged in as user@example.org" in result.output


def test_login_defaults_to_public_without_prompt(monkeypatch: pytest.MonkeyPatch) -> None:
    """Bare login should be browser-first and ready for public contributions."""

    class PublicDefaultClient(FakeDeviceAuthClient):
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
            assert worker_name == "Scout Laptop"
            assert default_upload_target == "public"
            assert worker_id is None
            assert workspace_id is None
            assert search_key_configured is False
            return ScoutTokenExchange(
                token="api-jwt",
                worker_id="worker-123",
                user_id="user-123",
                user_email="user@example.org",
                workspace_id=None,
            )

    saved: list[ScoutSession] = []
    monkeypatch.setattr(cli_module, "DeviceAuthClient", PublicDefaultClient)
    monkeypatch.setattr(cli_module, "save_session", saved.append)
    monkeypatch.setattr(cli_module.platform, "node", lambda: "Scout Laptop")
    monkeypatch.setattr(cli_module.webbrowser, "open", lambda _url: True)

    result = CliRunner().invoke(
        main,
        [
            "login",
            "--atlas-url",
            "https://atlas.example",
            "--no-browser",
        ],
    )

    assert result.exit_code == 0
    assert "Upload target" not in result.output
    assert saved[0].default_upload_target == "public"
    assert saved[0].workspace_id is None


def test_login_rejects_workspace_target_without_workspace_hint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Workspace-targeted login must remember an actual workspace id."""

    class WorkspaceLessClient(FakeDeviceAuthClient):
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
            assert default_upload_target == "workspace"
            assert worker_id is None
            assert workspace_id is None
            assert search_key_configured is False
            return ScoutTokenExchange(
                token="api-jwt",
                worker_id="worker-123",
                user_id="user-123",
                user_email="user@example.org",
                workspace_id=None,
            )

    saved: list[ScoutSession] = []
    monkeypatch.setattr(cli_module, "DeviceAuthClient", WorkspaceLessClient)
    monkeypatch.setattr(cli_module, "save_session", saved.append)

    result = CliRunner().invoke(
        main,
        [
            "login",
            "--atlas-url",
            "https://atlas.example",
            "--target",
            "workspace",
            "--no-browser",
        ],
    )

    assert result.exit_code != 0
    assert saved == []
    assert "Workspace required" in result.output
