"""Scout login HTTP error presentation tests."""

from __future__ import annotations

from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.auth import DeviceAuthError
from atlas_scout.cli import main


def test_login_does_not_print_html_auth_error_body(monkeypatch) -> None:
    """Login renders structured HTTP auth failures instead of raw HTML."""

    class HtmlErrorClient:
        async def request_device_code(self, atlas_url: str) -> object:
            assert atlas_url == "https://atlas.example"
            raise DeviceAuthError(
                error="http_405",
                description="",
                status_code=405,
                url="https://atlas.example/device/code",
                content_type="text/html; charset=utf-8",
            )

    monkeypatch.setattr(cli_module, "DeviceAuthClient", HtmlErrorClient)

    result = CliRunner().invoke(
        main,
        [
            "login",
            "--atlas-url",
            "https://atlas.example",
            "--no-browser",
        ],
    )

    assert result.exit_code != 0
    assert "Login failed: Atlas auth returned HTTP 405" in result.output
    assert "https://atlas.example" in result.output
    assert "https://atlas.localhost" not in result.output
    assert "<html" not in result.output
    assert "Method Not Allowed" not in result.output


def test_login_keeps_generic_server_error_out_of_stdout(monkeypatch) -> None:
    """Generic server exception names are converted into structured stderr output."""

    class GenericServerErrorClient:
        async def request_device_code(self, atlas_url: str) -> object:
            assert atlas_url == "https://atlas.localhost"
            raise DeviceAuthError(
                error="http_500",
                description="HTTPError",
                status_code=500,
                url="https://atlas.localhost/device/code",
                content_type="application/json;charset=UTF-8",
            )

    monkeypatch.setattr(cli_module, "DeviceAuthClient", GenericServerErrorClient)

    result = CliRunner().invoke(
        main,
        [
            "login",
            "--atlas-url",
            "https://atlas.localhost",
            "--no-browser",
        ],
    )

    assert result.exit_code != 0
    assert result.stdout == ""
    assert "Login failed:" in result.stderr
    assert "HTTP 500" in result.stderr
    assert "https://atlas.localhost/device/code" in result.stderr
    assert "HTTPError" not in result.stderr
