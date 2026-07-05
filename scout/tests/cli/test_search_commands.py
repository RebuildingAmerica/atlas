"""Scout search command tests."""

from __future__ import annotations

from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.cli import main


def test_search_connect_status_and_disconnect(monkeypatch) -> None:
    """Search commands connect Scout to search-backed discovery."""
    saved: list[str] = []
    deleted: list[bool] = []
    configured = {"value": False}

    def save(value: str) -> None:
        saved.append(value)
        configured["value"] = True

    def delete() -> bool:
        deleted.append(True)
        configured["value"] = False
        return True

    monkeypatch.setattr(cli_module, "save_search_api_key", save)
    monkeypatch.setattr(cli_module, "delete_stored_search_api_key", delete)
    monkeypatch.setattr(cli_module, "has_search_api_key", lambda: configured["value"])

    runner = CliRunner()
    result = runner.invoke(main, ["search", "connect", "--key", "search-secret"])
    assert result.exit_code == 0
    assert saved == ["search-secret"]
    assert "Search-backed discovery connected" in result.output

    result = runner.invoke(main, ["search", "status"])
    assert result.exit_code == 0
    assert "Search-backed discovery available" in result.output
    assert "OS credential store" in result.output

    result = runner.invoke(main, ["search", "disconnect"])
    assert result.exit_code == 0
    assert deleted == [True]
    assert "Search-backed discovery disconnected" in result.output


def test_search_status_prefers_environment(monkeypatch) -> None:
    """SEARCH_API_KEY is visible in status without touching stored config."""
    monkeypatch.setenv("SEARCH_API_KEY", "env-secret")
    monkeypatch.setattr(cli_module, "has_search_api_key", lambda: False)

    result = CliRunner().invoke(main, ["search", "status"])

    assert result.exit_code == 0
    assert "Search-backed discovery available" in result.output
    assert "SEARCH_API_KEY" in result.output


def test_search_key_group_is_not_available() -> None:
    """The old credential-shaped command surface should not exist."""
    result = CliRunner().invoke(main, ["search-key", "status"])

    assert result.exit_code != 0
    assert "No such command" in result.output
