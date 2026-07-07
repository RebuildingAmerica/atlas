"""Credential-store backend selection for Scout session persistence."""

from __future__ import annotations

import json
import os
from typing import TYPE_CHECKING

from atlas_scout.credentials import CredentialStoreError, SystemCredentialStore

if TYPE_CHECKING:
    from pathlib import Path

    from atlas_scout.credentials import CredentialStore

SESSION_CREDENTIAL_STORE = "system"
E2E_FILE_CREDENTIAL_STORE = "e2e-file"
E2E_FILE_CREDENTIAL_STORE_ENV = "ATLAS_SCOUT_E2E_FILE_CREDENTIAL_STORE"


class E2EFileCredentialStore:
    """Non-interactive credential store used only by Playwright e2e runs."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def save_secret(self, account: str, value: str) -> None:
        """Store one secret value in the e2e credential file."""
        secret = value.strip()
        if not secret:
            raise CredentialStoreError("Secret value is required.")
        credentials = self._read()
        credentials[account] = secret
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("w", encoding="utf-8") as handle:
            json.dump(credentials, handle, indent=2, sort_keys=True)
            handle.write("\n")
        self.path.chmod(0o600)

    def load_secret(self, account: str) -> str | None:
        """Return one secret value from the e2e credential file."""
        value = self._read().get(account)
        return value.strip() if isinstance(value, str) and value.strip() else None

    def delete_secret(self, account: str) -> bool:
        """Delete one secret value from the e2e credential file."""
        credentials = self._read()
        if account not in credentials:
            return False
        credentials.pop(account)
        if credentials:
            with self.path.open("w", encoding="utf-8") as handle:
                json.dump(credentials, handle, indent=2, sort_keys=True)
                handle.write("\n")
            self.path.chmod(0o600)
        elif self.path.exists():
            self.path.unlink()
        return True

    def _read(self) -> dict[str, str]:
        if not self.path.exists():
            return {}
        with self.path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise CredentialStoreError("E2E credential file must contain a JSON object.")
        return {str(key): str(value) for key, value in payload.items()}


def default_session_credential_store(path: Path) -> tuple[CredentialStore, str]:
    """Return the credential store Scout should use for session persistence."""
    if os.environ.get(E2E_FILE_CREDENTIAL_STORE_ENV) == "1":
        return E2EFileCredentialStore(
            path.with_suffix(".credentials.json")
        ), E2E_FILE_CREDENTIAL_STORE
    return SystemCredentialStore(), SESSION_CREDENTIAL_STORE
