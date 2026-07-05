"""Scout search-key credential storage tests."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest

from atlas_scout.credentials import SEARCH_API_KEY_ACCOUNT, CredentialStoreError
from atlas_scout.search_keys import (
    delete_stored_search_api_key,
    load_stored_search_api_key,
    resolve_search_api_key,
    save_search_api_key,
)

if TYPE_CHECKING:
    from pathlib import Path


class MemoryCredentialStore:
    """In-memory credential store for search-key tests."""

    def __init__(self) -> None:
        self.secrets: dict[str, str] = {}

    def save_secret(self, account: str, value: str) -> None:
        self.secrets[account] = value

    def load_secret(self, account: str) -> str | None:
        return self.secrets.get(account)

    def delete_secret(self, account: str) -> bool:
        return self.secrets.pop(account, None) is not None


def test_search_key_round_trips_through_credential_store(tmp_path: Path) -> None:
    """Search keys are stored in the OS credential store, not plaintext JSON."""
    credentials = MemoryCredentialStore()
    legacy_path = tmp_path / "search-key.json"

    save_search_api_key(
        " search-secret ",
        credential_store=credentials,
        legacy_path=legacy_path,
    )

    assert not legacy_path.exists()
    assert credentials.secrets[SEARCH_API_KEY_ACCOUNT] == "search-secret"
    assert (
        load_stored_search_api_key(
            credential_store=credentials,
            legacy_path=legacy_path,
        )
        == "search-secret"
    )
    assert delete_stored_search_api_key(
        credential_store=credentials,
        legacy_path=legacy_path,
    )
    assert credentials.secrets == {}


def test_search_key_load_refuses_legacy_plaintext_file(tmp_path: Path) -> None:
    """Legacy plaintext search-key files are not used silently."""
    legacy_path = tmp_path / "search-key.json"
    legacy_path.write_text(
        json.dumps({"search_api_key": "search-secret"}),
        encoding="utf-8",
    )

    with pytest.raises(CredentialStoreError, match="plaintext"):
        load_stored_search_api_key(
            credential_store=MemoryCredentialStore(),
            legacy_path=legacy_path,
        )


def test_search_key_delete_removes_legacy_plaintext_file(tmp_path: Path) -> None:
    """The delete command can clean up disposable pre-launch plaintext files."""
    credentials = MemoryCredentialStore()
    legacy_path = tmp_path / "search-key.json"
    legacy_path.write_text(
        json.dumps({"search_api_key": "search-secret"}),
        encoding="utf-8",
    )

    assert delete_stored_search_api_key(
        credential_store=credentials,
        legacy_path=legacy_path,
    )
    assert not legacy_path.exists()


def test_resolve_search_api_key_prefers_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Environment search keys remain ephemeral overrides."""
    monkeypatch.setenv("SEARCH_API_KEY", " env-secret ")

    assert (
        resolve_search_api_key(
            credential_store=MemoryCredentialStore(),
            legacy_path=tmp_path / "search-key.json",
        )
        == "env-secret"
    )
