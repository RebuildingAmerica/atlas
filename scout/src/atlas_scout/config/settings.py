"""Persistent user settings for Scout config profile selection."""

from __future__ import annotations

import tomllib
from typing import TYPE_CHECKING

from pydantic import BaseModel

from atlas_scout.config import paths
from atlas_scout.config.paths import DEFAULT_PROFILE_NAME

if TYPE_CHECKING:
    from pathlib import Path


class Settings(BaseModel):
    """Persistent user settings stored outside of any config profile."""

    active_profile: str = DEFAULT_PROFILE_NAME


def load_settings() -> Settings:
    """Load settings from disk, falling back to defaults."""
    if paths.SETTINGS_PATH.exists():
        with paths.SETTINGS_PATH.open("rb") as f:
            data = tomllib.load(f)
        return Settings.model_validate(data)
    return Settings()


def save_settings(settings: Settings) -> None:
    """Persist settings to disk."""
    paths.SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    lines = [f'active_profile = "{settings.active_profile}"', ""]
    paths.SETTINGS_PATH.write_text("\n".join(lines))


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
    return paths.SCOUT_CONFIGS_DIR / f"{get_active_profile_name()}.toml"
