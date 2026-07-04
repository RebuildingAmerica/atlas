"""Scout auth session persistence tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

import atlas_scout.auth as auth_module
from atlas_scout.auth import FileSessionStore, ScoutSession

if TYPE_CHECKING:
    from pathlib import Path

    import pytest


def test_file_session_store_loads_none_when_missing(tmp_path: Path) -> None:
    """Missing session files mean Scout is logged out."""
    assert FileSessionStore(tmp_path / "missing.json").load() is None


def test_file_session_store_round_trips_session(tmp_path: Path) -> None:
    """Scout persists a worker session with target metadata."""
    store = FileSessionStore(tmp_path / "session.json")
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

    assert store.load() == session


def test_file_session_store_deletes_session(tmp_path: Path) -> None:
    """Logout removes the persisted worker session."""
    store = FileSessionStore(tmp_path / "session.json")
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


def test_file_session_store_delete_ignores_missing_file(tmp_path: Path) -> None:
    """Deleting an absent session is a no-op for idempotent logout."""
    FileSessionStore(tmp_path / "missing.json").delete()


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
