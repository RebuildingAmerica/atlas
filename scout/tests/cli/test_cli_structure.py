"""Structure checks for the Scout CLI module split."""

from __future__ import annotations

import json
import tomllib
from pathlib import Path


def test_cli_root_stays_as_command_wiring() -> None:
    """Keep the root CLI readable by pushing command bodies into focused modules."""
    scout_package = Path(__file__).parents[2] / "src" / "atlas_scout"
    cli_lines = (scout_package / "cli.py").read_text(encoding="utf-8").splitlines()

    assert len(cli_lines) <= 40
    assert "main.add_command" not in "\n".join(cli_lines)
    assert "_CliFacadeModule" not in "\n".join(cli_lines)
    for module_name in (
        "cli_app.py",
        "cli_compat.py",
        "auth_commands.py",
        "config_commands.py",
        "daemon_commands.py",
        "local_model_commands.py",
        "pipeline_commands.py",
        "runs_commands.py",
        "schedule_commands.py",
        "setup_commands.py",
        "worker_commands.py",
    ):
        assert (scout_package / module_name).exists(), module_name


def test_articles_command_group_stays_as_command_wiring() -> None:
    """Keep article-specific crawl/import/stat bodies out of the command router."""
    scout_package = Path(__file__).parents[2] / "src" / "atlas_scout"
    articles_lines = (
        (scout_package / "articles_commands.py").read_text(encoding="utf-8").splitlines()
    )
    articles_source = "\n".join(articles_lines)

    assert len(articles_lines) <= 80
    assert "async def" not in articles_source
    assert "@articles.command" not in articles_source
    assert "articles.add_command" in articles_source
    for module_name in (
        "command_support.py",
        "crawl_commands.py",
        "export_commands.py",
        "frontier_commands.py",
        "import_commands.py",
        "stats_commands.py",
    ):
        assert (scout_package / "articles" / module_name).exists(), module_name


def test_article_modules_stay_under_three_hundred_lines() -> None:
    """Keep article modules small enough to read in one sitting."""
    scout_package = Path(__file__).parents[2] / "src" / "atlas_scout"
    article_modules = list((scout_package / "articles").glob("*.py"))

    oversized = {
        path.name: line_count
        for path in article_modules
        if (line_count := len(path.read_text(encoding="utf-8").splitlines())) > 300
    }

    assert oversized == {}
    assert len(article_modules) > 0


def test_default_pytest_does_not_force_coverage_gate() -> None:
    """Keep normal Scout tests fast while making coverage an explicit gate."""
    scout_root = Path(__file__).parents[2]
    package_scripts = json.loads((scout_root / "package.json").read_text(encoding="utf-8"))[
        "scripts"
    ]
    pyproject = tomllib.loads((scout_root / "pyproject.toml").read_text(encoding="utf-8"))
    addopts = pyproject["tool"]["pytest"]["ini_options"].get("addopts", "")
    coverage_report = pyproject["tool"]["coverage"]["report"]

    assert "--cov" not in addopts
    assert package_scripts["test"] == "uv run pytest"
    assert package_scripts["test:coverage"] == (
        "uv run pytest --cov=atlas_scout --cov-branch "
        "--cov-report=term-missing --cov-fail-under=100"
    )
    assert coverage_report["fail_under"] == 100
