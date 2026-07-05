"""Search connection usage across Scout commands."""

from __future__ import annotations

import io
from typing import TYPE_CHECKING, Any

import pytest
from click.testing import CliRunner
from rich.console import Console

import atlas_scout.cli as cli_module
from atlas_scout.cli import main
from atlas_scout.config import ScheduleConfig, ScheduleTarget, ScoutConfig, StoreConfig
from atlas_scout.local_models import LocalModelResolution

if TYPE_CHECKING:
    from pathlib import Path


def _config(tmp_path: Path, *, scheduled: bool = False) -> ScoutConfig:
    schedule = (
        ScheduleConfig(targets=[ScheduleTarget(location="Austin, TX", issues=["housing"])])
        if scheduled
        else ScheduleConfig()
    )
    return ScoutConfig(schedule=schedule, store=StoreConfig(path=str(tmp_path / "scout.db")))


def _ready_model() -> LocalModelResolution:
    return LocalModelResolution(
        ready=True,
        provider="ollama",
        model="llama3.1:8b",
        base_url="http://localhost:11434",
        message="Using Ollama with llama3.1:8b.",
    )


def _capture_output(monkeypatch: pytest.MonkeyPatch) -> io.StringIO:
    output = io.StringIO()
    monkeypatch.setattr(
        cli_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    monkeypatch.setattr(
        cli_module,
        "err_console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    return output


def test_run_search_mode_uses_stored_search_connection(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Search-mode runs should use the connected search credential by default."""
    captured: dict[str, Any] = {}

    async def fake_pipeline(*, search_api_key: str | None, **kwargs: Any) -> None:
        captured["search_api_key"] = search_api_key
        captured["location"] = kwargs["location"]
        captured["issues"] = kwargs["issues"]

    monkeypatch.setattr(cli_module, "load_config", lambda _path: _config(tmp_path))
    monkeypatch.setattr(cli_module, "resolve_search_api_key", lambda _explicit=None: "stored-key")
    monkeypatch.setattr(cli_module, "resolve_local_model", lambda *_a, **_k: _ready_model())
    monkeypatch.setattr(cli_module, "_run_pipeline", fake_pipeline)

    result = CliRunner().invoke(
        main,
        ["run", "--location", "Austin, TX", "--issues", "housing", "--quiet"],
        env={"SEARCH_API_KEY": ""},
    )

    assert result.exit_code == 0, result.output
    assert captured == {
        "search_api_key": "stored-key",
        "location": "Austin, TX",
        "issues": ["housing"],
    }


def test_run_without_urls_points_to_search_connect(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The empty run hint should teach the connection workflow, not raw key entry."""
    monkeypatch.setattr(cli_module, "load_config", lambda _path: _config(tmp_path))
    monkeypatch.setattr(cli_module, "resolve_search_api_key", lambda _explicit=None: "")

    result = CliRunner().invoke(main, ["run"], env={"SEARCH_API_KEY": ""})

    assert result.exit_code != 0
    assert "scout search connect" in result.output
    assert "--search-api-key KEY" not in result.output


def test_schedule_run_once_uses_stored_search_connection(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Scheduled runs should use the connected search credential without a key flag."""
    captured: dict[str, str] = {}
    output = _capture_output(monkeypatch)

    async def fake_run_schedule_once(_config: ScoutConfig, search_api_key: str) -> list[str]:
        captured["search_api_key"] = search_api_key
        return ["run-1"]

    import atlas_scout.scheduler as scheduler_module

    monkeypatch.setattr(cli_module, "load_config", lambda _path: _config(tmp_path, scheduled=True))
    monkeypatch.setattr(cli_module, "resolve_search_api_key", lambda _explicit=None: "stored-key")
    monkeypatch.setattr(scheduler_module, "run_schedule_once", fake_run_schedule_once)

    result = CliRunner().invoke(main, ["schedule", "run-once"], env={"SEARCH_API_KEY": ""})

    assert result.exit_code == 0, result.output
    assert captured["search_api_key"] == "stored-key"
    assert "Completed 1 runs" in output.getvalue()


def test_schedule_start_requires_search_connection_when_targets_exist(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A scheduled search loop with targets should fail clearly without search connected."""
    output = _capture_output(monkeypatch)
    monkeypatch.setattr(cli_module, "load_config", lambda _path: _config(tmp_path, scheduled=True))
    monkeypatch.setattr(cli_module, "resolve_search_api_key", lambda _explicit=None: "")

    result = CliRunner().invoke(main, ["schedule", "start"], env={"SEARCH_API_KEY": ""})

    assert result.exit_code != 0
    rendered = output.getvalue()
    assert "Search-backed discovery is not connected" in rendered
    assert "scout search connect" in rendered
    assert "SEARCH_API_KEY" in rendered


def test_schedule_no_targets_does_not_require_search_connection(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No-target schedule commands should not force search setup first."""
    output = _capture_output(monkeypatch)
    monkeypatch.setattr(cli_module, "load_config", lambda _path: _config(tmp_path))
    monkeypatch.setattr(cli_module, "resolve_search_api_key", lambda _explicit=None: "")

    result = CliRunner().invoke(main, ["schedule", "run-once"], env={"SEARCH_API_KEY": ""})

    assert result.exit_code == 0
    assert "No schedule targets configured" in output.getvalue()


def test_daemon_start_uses_stored_search_connection(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Daemon startup should pass the connected search credential to the background runner."""
    captured: dict[str, Any] = {}

    async def fake_daemon_start(
        _config: ScoutConfig,
        *,
        config_path: Path,
        profile_name: str | None,
        debug: bool,
        search_api_key: str,
        interval: int,
    ) -> None:
        captured.update(
            {
                "config_path": config_path,
                "profile_name": profile_name,
                "debug": debug,
                "search_api_key": search_api_key,
                "interval": interval,
            }
        )

    config_path = tmp_path / "scout.toml"
    monkeypatch.setattr(cli_module, "load_config", lambda _path: _config(tmp_path, scheduled=True))
    monkeypatch.setattr(cli_module, "resolve_search_api_key", lambda _explicit=None: "stored-key")
    monkeypatch.setattr(cli_module, "_daemon_start", fake_daemon_start)

    result = CliRunner().invoke(
        main,
        ["--config", str(config_path), "daemon", "start", "--interval", "300"],
        env={"SEARCH_API_KEY": ""},
    )

    assert result.exit_code == 0, result.output
    assert captured["search_api_key"] == "stored-key"
    assert captured["interval"] == 300
    assert captured["config_path"] == config_path


@pytest.mark.parametrize(
    "key",
    ["llm.api_key", "contribution.api_key", "llm.token", "llm.secret", "llm.credential"],
)
def test_config_set_rejects_secret_fields_without_echoing_value(
    key: str,
    tmp_path: Path,
) -> None:
    """Profile config is not persistent secret storage."""
    secret = "super-secret-value"
    config_path = tmp_path / "scout.toml"

    result = CliRunner().invoke(main, ["--config", str(config_path), "config", "set", key, secret])

    assert result.exit_code != 0
    assert "not saved in Scout profile config" in result.output
    assert secret not in result.output
    assert not config_path.exists()
