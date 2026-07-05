"""Local search API key storage for Scout."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from atlas_scout.config import SCOUT_CONFIG_DIR
from atlas_scout.credentials import (
    SEARCH_API_KEY_ACCOUNT,
    CredentialStore,
    CredentialStoreError,
    SystemCredentialStore,
)

if TYPE_CHECKING:
    from pathlib import Path

SEARCH_KEY_PATH = SCOUT_CONFIG_DIR / "search-key.json"


def _credential_store(credential_store: CredentialStore | None) -> CredentialStore:
    """Return the configured credential store."""
    return credential_store or SystemCredentialStore()


def _delete_legacy_file(path: Path) -> bool:
    """Delete the legacy plaintext search-key file when present."""
    if not path.exists():
        return False
    path.unlink()
    return True


def _raise_for_legacy_file(path: Path) -> None:
    """Refuse to read pre-launch plaintext search-key files."""
    if path.exists():
        raise CredentialStoreError(
            "Legacy plaintext search key file found. Run `scout search-key delete` "
            "and set the key again."
        )


def save_search_api_key(
    value: str,
    *,
    credential_store: CredentialStore | None = None,
    legacy_path: Path = SEARCH_KEY_PATH,
) -> None:
    """Persist a search API key in the OS credential store."""
    key = value.strip()
    if not key:
        raise ValueError("Search API key is required.")
    _credential_store(credential_store).save_secret(SEARCH_API_KEY_ACCOUNT, key)
    _delete_legacy_file(legacy_path)


def load_stored_search_api_key(
    *,
    credential_store: CredentialStore | None = None,
    legacy_path: Path = SEARCH_KEY_PATH,
) -> str:
    """Return the stored search API key, or an empty string when unset."""
    _raise_for_legacy_file(legacy_path)
    return _credential_store(credential_store).load_secret(SEARCH_API_KEY_ACCOUNT) or ""


def delete_stored_search_api_key(
    *,
    credential_store: CredentialStore | None = None,
    legacy_path: Path = SEARCH_KEY_PATH,
) -> bool:
    """Remove the stored search API key."""
    deleted_legacy = _delete_legacy_file(legacy_path)
    deleted_secure = _credential_store(credential_store).delete_secret(SEARCH_API_KEY_ACCOUNT)
    return deleted_legacy or deleted_secure


def resolve_search_api_key(
    explicit: str | None = None,
    *,
    credential_store: CredentialStore | None = None,
    legacy_path: Path = SEARCH_KEY_PATH,
) -> str:
    """Resolve the search key from a flag, environment, or Scout storage."""
    if explicit and explicit.strip():
        return explicit.strip()
    env_value = os.environ.get("SEARCH_API_KEY", "").strip()
    if env_value:
        return env_value
    return load_stored_search_api_key(
        credential_store=credential_store,
        legacy_path=legacy_path,
    )


def has_search_api_key(
    *,
    credential_store: CredentialStore | None = None,
    legacy_path: Path = SEARCH_KEY_PATH,
) -> bool:
    """Return whether Scout currently has a usable search API key."""
    return bool(resolve_search_api_key(credential_store=credential_store, legacy_path=legacy_path))
