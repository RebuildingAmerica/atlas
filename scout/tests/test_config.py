import textwrap
from pathlib import Path

from atlas_scout.config import ScoutConfig, load_config


def test_load_config_defaults():
    config = ScoutConfig()
    assert config.llm.provider == "ollama"
    assert config.llm.model == "llama3.1:8b"
    assert config.llm.max_concurrent == 10
    assert config.scraper.max_concurrent_fetches == 20
    assert config.scraper.page_cache_ttl_days == 7
    assert config.pipeline.min_entry_score == 0.3


def test_load_config_from_toml(tmp_path: Path):
    config_file = tmp_path / "scout.toml"
    config_file.write_text(textwrap.dedent("""\
        [llm]
        provider = "anthropic"
        model = "claude-sonnet-4-20250514"
        max_concurrent = 5

        [scraper]
        max_concurrent_fetches = 10
    """))
    config = load_config(config_file)
    assert config.llm.provider == "anthropic"
    assert config.llm.model == "claude-sonnet-4-20250514"
    assert config.llm.max_concurrent == 5
    assert config.scraper.max_concurrent_fetches == 10
    assert config.scraper.page_cache_ttl_days == 7


def test_load_config_with_targets(tmp_path: Path):
    config_file = tmp_path / "scout.toml"
    config_file.write_text(textwrap.dedent("""\
        [llm]
        provider = "ollama"

        [[schedule.targets]]
        location = "Austin, TX"
        issues = ["housing_affordability", "education_funding_and_policy"]
        search_depth = "standard"

        [[schedule.targets]]
        location = "Houston, TX"
        issues = ["healthcare_access_and_coverage"]
        search_depth = "deep"
    """))
    config = load_config(config_file)
    assert len(config.schedule.targets) == 2
    assert config.schedule.targets[0].location == "Austin, TX"
    assert config.schedule.targets[1].search_depth == "deep"


def test_load_config_missing_file_returns_defaults(tmp_path: Path):
    config = load_config(tmp_path / "nonexistent.toml")
    assert config.llm.provider == "ollama"
