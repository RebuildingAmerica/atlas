"""Structure checks for the Scout CLI module split."""

from __future__ import annotations

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
        "article_command_support.py",
        "article_crawl_commands.py",
        "article_export_commands.py",
        "article_frontier_commands.py",
        "article_import_commands.py",
        "article_stats_commands.py",
    ):
        assert (scout_package / module_name).exists(), module_name


def test_article_modules_stay_under_three_hundred_lines() -> None:
    """Keep article modules small enough to read in one sitting."""
    scout_package = Path(__file__).parents[2] / "src" / "atlas_scout"
    article_modules = list(scout_package.glob("article_*.py"))

    oversized = {
        path.name: line_count
        for path in article_modules
        if (line_count := len(path.read_text(encoding="utf-8").splitlines())) > 300
    }

    assert oversized == {}
