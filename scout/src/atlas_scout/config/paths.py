"""OS-standard config/data directory resolution for Scout."""

from __future__ import annotations

import os
import sys
from pathlib import Path

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


def prepare_user_dirs() -> None:
    """Ensure the standardized Scout config and data directories exist."""
    SCOUT_CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
    SCOUT_DATA_DIR.mkdir(parents=True, exist_ok=True)
