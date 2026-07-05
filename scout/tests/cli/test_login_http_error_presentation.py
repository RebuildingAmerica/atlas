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
            assert atlas_url == "https://atlas.localhost:1355"
            raise DeviceAuthError(
                error="http_405",
                description="",
                status_code=405,
                url="https://atlas.localhost:1355/api/auth/device/code",
                content_type="text/html; charset=utf-8",
            )

    monkeypatch.setattr(cli_module, "DeviceAuthClient", HtmlErrorClient)

    result = CliRunner().invoke(
        main,
        [
            "login",
            "--atlas-url",
            "https://atlas.localhost:1355",
            "--no-browser",
        ],
    )

    assert result.exit_code != 0
    assert "Login failed: Atlas auth returned HTTP 405" in result.output
    assert "https://atlas.localhost:1355" in result.output
    assert "<html" not in result.output
    assert "Method Not Allowed" not in result.output
