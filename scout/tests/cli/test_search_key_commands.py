"""Scout search-key command tests."""

from __future__ import annotations

from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.cli import main


def test_search_key_set_status_and_delete(monkeypatch) -> None:
    """Search-key commands delegate to the local secret store."""
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
    result = runner.invoke(main, ["search-key", "set", "--value", "search-secret"])
    assert result.exit_code == 0
    assert saved == ["search-secret"]
    assert "Search key saved" in result.output

    result = runner.invoke(main, ["search-key", "status"])
    assert result.exit_code == 0
    assert "Search key configured" in result.output
    assert "OS credential store" in result.output

    result = runner.invoke(main, ["search-key", "delete"])
    assert result.exit_code == 0
    assert deleted == [True]
    assert "Search key deleted" in result.output


def test_search_key_status_prefers_environment(monkeypatch) -> None:
    """SEARCH_API_KEY is visible in status without touching stored config."""
    monkeypatch.setenv("SEARCH_API_KEY", "env-secret")
    monkeypatch.setattr(cli_module, "has_search_api_key", lambda: False)

    result = CliRunner().invoke(main, ["search-key", "status"])

    assert result.exit_code == 0
    assert "SEARCH_API_KEY" in result.output
