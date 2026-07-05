"""Scout auth session persistence tests."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest

import atlas_scout.auth as auth_module
from atlas_scout.auth import (
    SESSION_TOKEN_ACCOUNT,
    FileSessionStore,
    ScoutSession,
)
from atlas_scout.credentials import CredentialStoreError

if TYPE_CHECKING:
    from pathlib import Path


class MemoryCredentialStore:
    """In-memory credential store for session persistence tests."""

    def __init__(self) -> None:
        self.secrets: dict[str, str] = {}

    def save_secret(self, account: str, value: str) -> None:
        self.secrets[account] = value

    def load_secret(self, account: str) -> str | None:
        return self.secrets.get(account)

    def delete_secret(self, account: str) -> bool:
        return self.secrets.pop(account, None) is not None


def test_file_session_store_loads_none_when_missing(tmp_path: Path) -> None:
    """Missing session files mean Scout is logged out."""
    assert (
        FileSessionStore(
            tmp_path / "missing.json",
            credential_store=MemoryCredentialStore(),
        ).load()
        is None
    )


def test_file_session_store_round_trips_session(tmp_path: Path) -> None:
    """Scout persists a worker session with target metadata."""
    credentials = MemoryCredentialStore()
    path = tmp_path / "session.json"
    store = FileSessionStore(path, credential_store=credentials)
    session = ScoutSession(
        atlas_url="https://atlas.example",
        access_token="secret-token",
        worker_id="worker-123",
        user_id="user-123",
        user_email="user@example.org",
        default_upload_target="workspace",
        workspace_id="org-123",
    )

    store.save(session)

    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["credential_store"] == "system"
    assert "access_token" not in payload
    assert credentials.secrets[SESSION_TOKEN_ACCOUNT] == "secret-token"
    assert store.load() == session


def test_file_session_store_deletes_session(tmp_path: Path) -> None:
    """Logout removes the persisted worker session."""
    credentials = MemoryCredentialStore()
    store = FileSessionStore(tmp_path / "session.json", credential_store=credentials)
    store.save(
        ScoutSession(
            atlas_url="https://atlas.example",
            access_token="secret-token",
            worker_id="worker-123",
            user_id="user-123",
            user_email="user@example.org",
        )
    )

    store.delete()

    assert store.load() is None
    assert SESSION_TOKEN_ACCOUNT not in credentials.secrets


def test_file_session_store_delete_ignores_missing_file(tmp_path: Path) -> None:
    """Deleting an absent session is a no-op for idempotent logout."""
    FileSessionStore(
        tmp_path / "missing.json",
        credential_store=MemoryCredentialStore(),
    ).delete()


def test_file_session_store_refuses_legacy_plaintext_session(tmp_path: Path) -> None:
    """Legacy plaintext token files are not valid secure Scout sessions."""
    path = tmp_path / "session.json"
    path.write_text(
        json.dumps(
            {
                "access_token": "secret-token",
                "atlas_url": "https://atlas.example",
                "user_email": "user@example.org",
                "user_id": "user-123",
                "worker_id": "worker-123",
            }
        ),
        encoding="utf-8",
    )
    store = FileSessionStore(path, credential_store=MemoryCredentialStore())

    with pytest.raises(CredentialStoreError, match="plaintext"):
        store.load()


def test_file_session_store_requires_keychain_secret_for_metadata(tmp_path: Path) -> None:
    """Session metadata without a keychain token is an explicit storage error."""
    path = tmp_path / "session.json"
    path.write_text(
        json.dumps(
            {
                "atlas_url": "https://atlas.example",
                "credential_store": "system",
                "user_email": "user@example.org",
                "user_id": "user-123",
                "worker_id": "worker-123",
            }
        ),
        encoding="utf-8",
    )
    store = FileSessionStore(path, credential_store=MemoryCredentialStore())

    with pytest.raises(CredentialStoreError, match="missing"):
        store.load()


def test_default_session_helpers_delegate_to_store(monkeypatch: pytest.MonkeyPatch) -> None:
    """Module-level helpers use the configured session store."""
    session = ScoutSession(
        atlas_url="https://atlas.example",
        access_token="secret-token",
        worker_id="worker-123",
        user_id="user-123",
        user_email="user@example.org",
    )
    calls: list[object] = []

    class FakeStore:
        def load(self) -> ScoutSession:
            calls.append("load")
            return session

        def save(self, stored_session: ScoutSession) -> None:
            calls.append(stored_session)

        def delete(self) -> None:
            calls.append("delete")

    monkeypatch.setattr(auth_module, "FileSessionStore", FakeStore)

    assert auth_module.load_session() == session
    auth_module.save_session(session)
    auth_module.delete_session()

    assert calls == ["load", session, "delete"]
