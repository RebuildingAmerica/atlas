"""Local persistence for the logged-in Scout worker session."""

from __future__ import annotations

import json
from dataclasses import asdict
from typing import TYPE_CHECKING

from atlas_scout.auth.credential_store import (
    SESSION_CREDENTIAL_STORE,
    default_session_credential_store,
)
from atlas_scout.auth.models import ScoutSession
from atlas_scout.config import SCOUT_CONFIG_DIR
from atlas_scout.credentials import SESSION_TOKEN_ACCOUNT, CredentialStoreError

if TYPE_CHECKING:
    from pathlib import Path

    from atlas_scout.credentials import CredentialStore

SESSION_PATH = SCOUT_CONFIG_DIR / "session.json"


class FileSessionStore:
    """Persist a Scout session in a local JSON file."""

    def __init__(
        self,
        path: Path = SESSION_PATH,
        credential_store: CredentialStore | None = None,
        credential_store_name: str | None = None,
    ) -> None:
        self.path = path
        default_store, default_name = default_session_credential_store(path)
        self.credential_store = credential_store or default_store
        self.credential_store_name = credential_store_name or (
            SESSION_CREDENTIAL_STORE if credential_store is not None else default_name
        )

    def load(self) -> ScoutSession | None:
        """Return the stored Scout session, if present."""
        if not self.path.exists():
            return None
        with self.path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if "access_token" in payload:
            raise CredentialStoreError(
                "Legacy plaintext Scout session file found. Delete it and run `scout login`."
            )
        if payload.get("credential_store") != self.credential_store_name:
            raise CredentialStoreError(
                "Scout session metadata uses a different credential store. "
                "Delete it and run `scout login`."
            )
        access_token = self.credential_store.load_secret(SESSION_TOKEN_ACCOUNT)
        if access_token is None:
            raise CredentialStoreError(
                "Scout session metadata exists, but the OS credential store token is missing. "
                "Run `scout logout` and `scout login`."
            )
        worker_name = payload.get("worker_name")
        if worker_name is not None and not isinstance(worker_name, str):
            raise ValueError("Scout session field worker_name must be a string")
        return ScoutSession(
            atlas_url=str(payload["atlas_url"]),
            access_token=access_token,
            worker_id=str(payload["worker_id"]),
            user_id=str(payload["user_id"]),
            user_email=str(payload["user_email"]),
            worker_name=worker_name,
            default_upload_target=payload.get("default_upload_target"),
            workspace_id=payload.get("workspace_id"),
        )

    def save(self, session: ScoutSession) -> None:
        """Store session metadata on disk and the token in OS credential storage."""
        self.credential_store.save_secret(SESSION_TOKEN_ACCOUNT, session.access_token)
        payload = asdict(session)
        payload.pop("access_token")
        payload["credential_store"] = self.credential_store_name
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
        self.path.chmod(0o600)

    def delete(self) -> None:
        """Remove any stored Scout session."""
        self.credential_store.delete_secret(SESSION_TOKEN_ACCOUNT)
        if self.path.exists():
            self.path.unlink()


def load_session() -> ScoutSession | None:
    """Load the default Scout session."""
    return FileSessionStore().load()


def save_session(session: ScoutSession) -> None:
    """Save the default Scout session."""
    FileSessionStore().save(session)


def delete_session() -> None:
    """Delete the default Scout session."""
    FileSessionStore().delete()
