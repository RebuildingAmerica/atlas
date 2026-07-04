"""Local search API key storage for Scout."""

from __future__ import annotations

import json
import os
from typing import TYPE_CHECKING

from atlas_scout.config import SCOUT_CONFIG_DIR

if TYPE_CHECKING:
    from pathlib import Path

SEARCH_KEY_PATH = SCOUT_CONFIG_DIR / "search-key.json"


def save_search_api_key(value: str, path: Path = SEARCH_KEY_PATH) -> None:
    """Persist a search API key with user-only file permissions."""
    key = value.strip()
    if not key:
        raise ValueError("Search API key is required.")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump({"search_api_key": key}, handle, indent=2, sort_keys=True)
        handle.write("\n")
    path.chmod(0o600)


def load_stored_search_api_key(path: Path = SEARCH_KEY_PATH) -> str:
    """Return the stored search API key, or an empty string when unset."""
    if not path.exists():
        return ""
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    value = payload.get("search_api_key")
    if not isinstance(value, str):
        raise ValueError("Search key file is invalid.")
    return value.strip()


def delete_stored_search_api_key(path: Path = SEARCH_KEY_PATH) -> bool:
    """Remove the stored search API key."""
    if not path.exists():
        return False
    path.unlink()
    return True


def resolve_search_api_key(explicit: str | None = None) -> str:
    """Resolve the search key from a flag, environment, or Scout storage."""
    if explicit and explicit.strip():
        return explicit.strip()
    env_value = os.environ.get("SEARCH_API_KEY", "").strip()
    if env_value:
        return env_value
    return load_stored_search_api_key()


def has_search_api_key() -> bool:
    """Return whether Scout currently has a usable search API key."""
    return bool(resolve_search_api_key())
