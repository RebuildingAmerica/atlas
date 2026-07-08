"""Comprehensive coverage tests for atlas_scout.cli."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from click.testing import CliRunner

import atlas_scout.cli as cli_module
from atlas_scout.cli import main

from .test_cli_coverage_support import _make_config, _ready_local_model_resolution


def test_run_overrides_provider_and_model(tmp_path: Path, monkeypatch) -> None:
    """--provider and --model should mutate the loaded config before running."""
    captured: dict[str, Any] = {}

    async def fake_pipeline(*, config, **kwargs: Any) -> Any:
        captured["provider"] = config.llm.provider
        captured["model"] = config.llm.model
        captured["search_api_key"] = kwargs.get("search_api_key")
        captured["direct_urls"] = kwargs.get("direct_urls")
        return None

    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    monkeypatch.setattr(cli_module, "_run_pipeline", fake_pipeline)

    result = CliRunner().invoke(
        main,
        [
            "run",
            "--provider",
            "anthropic",
            "--model",
            "claude-sonnet",
            "--quiet",
            "https://example.com",
        ],
    )
    assert result.exit_code == 0
    assert captured["provider"] == "anthropic"
    assert captured["model"] == "claude-sonnet"
    assert captured["direct_urls"] == ["https://example.com"]


def test_sync_command_invokes_turnkey_helper(
    tmp_path: Path, monkeypatch
) -> None:
    """Top-level sync should route through the turnkey multi-run helper."""
    captured: dict[str, Any] = {}

    async def fake_sync_runs(
        config,
        run_ids: tuple[str, ...],
        *,
        all_ready: bool,
        atlas_url: str | None,
        api_key: str | None,
        target: str | None,
        workspace: str | None,
    ) -> None:
        captured.update(
            {
                "config": config,
                "run_ids": run_ids,
                "all_ready": all_ready,
                "atlas_url": atlas_url,
                "api_key": api_key,
                "target": target,
                "workspace": workspace,
            }
        )

    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    monkeypatch.setattr(cli_module, "_sync_runs", fake_sync_runs)

    result = CliRunner().invoke(
        main,
        [
            "sync",
            "run_1",
            "run_2",
            "--atlas-url",
            "https://atlas.example",
            "--api-key",
            "key_123",
            "--target",
            "workspace",
            "--workspace",
            "org_123",
        ],
    )

    assert result.exit_code == 0
    assert captured["run_ids"] == ("run_1", "run_2")
    assert captured["all_ready"] is False
    assert captured["atlas_url"] == "https://atlas.example"
    assert captured["api_key"] == "key_123"
    assert captured["target"] == "workspace"
    assert captured["workspace"] == "org_123"


def test_run_reads_urls_and_prompt_from_files(
    tmp_path: Path, monkeypatch
) -> None:
    """URLs from --file (with comments) and prompt from --prompt-file should be merged."""
    url_file = tmp_path / "urls.txt"
    url_file.write_text("https://a.com\n# comment\n\nhttps://b.com\n")
    prompt_file = tmp_path / "prompt.txt"
    prompt_file.write_text("Find legal aid orgs   \n")

    captured: dict[str, Any] = {}

    async def fake_pipeline(*, config, **kwargs: Any) -> Any:  # noqa: ARG001
        captured.update(kwargs)
        return None

    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    monkeypatch.setattr(cli_module, "_run_pipeline", fake_pipeline)
    monkeypatch.setattr(
        cli_module,
        "resolve_local_model",
        lambda *_args, **_kwargs: _ready_local_model_resolution(),
    )

    result = CliRunner().invoke(
        main,
        [
            "run",
            "-f",
            str(url_file),
            "--prompt-file",
            str(prompt_file),
            "--quiet",
            "--follow-links",
            "--max-link-depth",
            "5",
            "--max-pages-per-seed",
            "11",
        ],
    )
    assert result.exit_code == 0, result.output
    assert captured["direct_urls"] == ["https://a.com", "https://b.com"]
    assert captured["directive"] == "Find legal aid orgs"


def test_run_no_urls_no_search_key_errors(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    result = CliRunner().invoke(
        main,
        ["run"],
        env={
            "ATLAS_SCOUT_E2E_FILE_CREDENTIAL_STORE": "1",
            "SEARCH_API_KEY": "",
        },
    )
    assert result.exit_code != 0
    assert "Pass one or more URLs" in result.output
    assert "--location" in result.output
    assert "--issues" in result.output


def test_run_missing_location(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    result = CliRunner().invoke(
        main,
        [
            "run",
            "--issues",
            "housing",
            "--search-api-key",
            "key",
        ],
    )
    assert result.exit_code != 0
    assert "Pass one or more URLs" in result.output


def test_run_missing_issues(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(cli_module, "load_config", lambda _path: _make_config(tmp_path))
    result = CliRunner().invoke(
        main,
        [
            "run",
            "--location",
            "Austin, TX",
            "--search-api-key",
            "key",
        ],
    )
    assert result.exit_code != 0
    assert "--issues is required" in result.output
