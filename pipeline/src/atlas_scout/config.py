"""Configuration models for Atlas Scout."""

from __future__ import annotations

import os
import sys
import tomllib
from pathlib import Path

from pydantic import BaseModel, Field

APP_DIR_NAME = "atlas-scout"


def _standard_config_dir() -> Path:
    """Return the OS-standard per-user config directory for Scout."""
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_DIR_NAME
    if os.name == "nt":
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
        return base / APP_DIR_NAME
    xdg_config = os.environ.get("XDG_CONFIG_HOME")
    base = Path(xdg_config) if xdg_config else Path.home() / ".config"
    return base / APP_DIR_NAME


def _standard_data_dir() -> Path:
    """Return the OS-standard per-user data directory for Scout."""
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_DIR_NAME
    if os.name == "nt":
        local_appdata = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        base = Path(local_appdata) if local_appdata else Path.home() / "AppData" / "Local"
        return base / APP_DIR_NAME
    xdg_data = os.environ.get("XDG_DATA_HOME")
    base = Path(xdg_data) if xdg_data else Path.home() / ".local" / "share"
    return base / APP_DIR_NAME


SCOUT_CONFIG_DIR = _standard_config_dir()
SCOUT_DATA_DIR = _standard_data_dir()
SCOUT_CONFIGS_DIR = SCOUT_CONFIG_DIR / "configs"
DEFAULT_DB_PATH = SCOUT_DATA_DIR / "scout.db"

#: Name of the default profile, used when no active profile has been set.
DEFAULT_PROFILE_NAME = "default"

#: Path to the persistent settings file (tracks active profile and other prefs).
SETTINGS_PATH = SCOUT_CONFIG_DIR / "settings.toml"


class Settings(BaseModel):
    """Persistent user settings stored outside of any config profile."""

    active_profile: str = DEFAULT_PROFILE_NAME


def load_settings() -> Settings:
    """Load settings from disk, falling back to defaults."""
    if SETTINGS_PATH.exists():
        with SETTINGS_PATH.open("rb") as f:
            data = tomllib.load(f)
        return Settings.model_validate(data)
    return Settings()


def save_settings(settings: Settings) -> None:
    """Persist settings to disk."""
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    lines = [f'active_profile = "{settings.active_profile}"', ""]
    SETTINGS_PATH.write_text("\n".join(lines))


def get_active_profile_name() -> str:
    """Read the active profile name from settings."""
    return load_settings().active_profile


def set_active_profile_name(name: str) -> None:
    """Update the active profile in settings."""
    settings = load_settings()
    settings.active_profile = name
    save_settings(settings)


def get_active_config_path() -> Path:
    """Return the path to the active profile's config file."""
    return SCOUT_CONFIGS_DIR / f"{get_active_profile_name()}.toml"


class LLMConfig(BaseModel):
    """Configuration for the LLM provider (model selection and concurrency)."""

    provider: str = "ollama"
    model: str = "llama3.1:8b"
    base_url: str | None = None
    api_key: str | None = None
    max_concurrent: int = 10
    timeout_seconds: float = 120.0


class ScraperConfig(BaseModel):
    """Configuration for the web scraper (concurrency, depth, and caching)."""

    max_concurrent_searches: int = 0
    max_concurrent_fetches: int = 20
    page_cache_ttl_days: int = 7
    revisit_cached_urls: bool = False
    follow_links: bool = True
    max_link_depth: int = 2
    max_pages_per_seed: int = 20
    request_delay_ms: int = 200
    search_country: str = ""
    search_freshness: str = ""


class RuntimeConfig(BaseModel):
    """Configuration for adaptive runtime sizing and resource caps."""

    auto_tune: bool = True
    max_memory_percent: int = 70
    max_total_workers: int | None = None


class PipelineConfig(BaseModel):
    """Configuration for pipeline behavior (dedup, scoring, gap analysis)."""

    dedup_batch_size: int = 50
    min_entry_score: float = 0.3
    gap_analysis: bool = True
    iterative_deepening: bool = False
    reuse_cached_extractions: bool = True


class ScheduleTarget(BaseModel):
    """A single location+issues pair to run on a schedule."""

    location: str
    issues: list[str] = Field(default_factory=list)
    search_depth: str = "standard"


class ScheduleConfig(BaseModel):
    """Configuration for automated scheduled discovery runs."""

    enabled: bool = False
    cron: str = "0 2 * * *"
    max_concurrent_runs: int = 2
    targets: list[ScheduleTarget] = Field(default_factory=list)


class ContributionConfig(BaseModel):
    """Configuration for contributing discovered entries back to Atlas."""

    enabled: bool = False
    api_key: str = ""
    atlas_url: str = "https://atlas.rebuilding.us"
    min_score: float = 0.7


class StoreConfig(BaseModel):
    """Configuration for the local SQLite store path."""

    path: str = str(DEFAULT_DB_PATH)


class ScoutConfig(BaseModel):
    """Root configuration model for Atlas Scout."""

    llm: LLMConfig = Field(default_factory=LLMConfig)
    scraper: ScraperConfig = Field(default_factory=ScraperConfig)
    pipeline: PipelineConfig = Field(default_factory=PipelineConfig)
    runtime: RuntimeConfig = Field(default_factory=RuntimeConfig)
    schedule: ScheduleConfig = Field(default_factory=ScheduleConfig)
    contribution: ContributionConfig = Field(default_factory=ContributionConfig)
    store: StoreConfig = Field(default_factory=StoreConfig)


def load_config(path: Path) -> ScoutConfig:
    """Load ScoutConfig from a TOML file. Falls back to defaults if file is missing."""
    _prepare_user_dirs()

    if not path.exists():
        return ScoutConfig()

    with path.open("rb") as f:
        data = tomllib.load(f)

    return ScoutConfig.model_validate(data)


def _prepare_user_dirs() -> None:
    """Ensure the standardized Scout config and data directories exist."""
    SCOUT_CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
    SCOUT_DATA_DIR.mkdir(parents=True, exist_ok=True)
