"""System credential-store helpers for Scout secrets."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import keyring
from keyring.errors import KeyringError

KEYRING_SERVICE = "atlas-scout"
SESSION_TOKEN_ACCOUNT = "session-token"
SEARCH_API_KEY_ACCOUNT = "search-api-key"


class CredentialStoreError(RuntimeError):
    """Raised when Scout cannot use secure OS credential storage."""


class CredentialStore(Protocol):
    """Minimal secret store interface used by Scout persistence code."""

    def save_secret(self, account: str, value: str) -> None:
        """Store one secret value."""

    def load_secret(self, account: str) -> str | None:
        """Return one secret value, if present."""

    def delete_secret(self, account: str) -> bool:
        """Delete one secret value and return whether it existed."""


class KeyringModule(Protocol):
    """Subset of the keyring package used by Scout."""

    def get_keyring(self) -> object:
        """Return the active keyring backend."""

    def set_password(self, service_name: str, username: str, password: str) -> None:
        """Store a password in the active backend."""

    def get_password(self, service_name: str, username: str) -> str | None:
        """Load a password from the active backend."""

    def delete_password(self, service_name: str, username: str) -> None:
        """Delete a password from the active backend."""


@dataclass(slots=True)
class SystemCredentialStore:
    """Credential store backed by the operating system keychain."""

    service_name: str = KEYRING_SERVICE
    keyring_module: KeyringModule = keyring

    def save_secret(self, account: str, value: str) -> None:
        """Store one secret in the OS credential store."""
        secret = value.strip()
        if not secret:
            raise CredentialStoreError("Secret value is required.")
        store = self._available_keyring()
        try:
            store.set_password(self.service_name, account, secret)
        except KeyringError as exc:
            raise CredentialStoreError("Scout could not write to the OS credential store.") from exc

    def load_secret(self, account: str) -> str | None:
        """Load one secret from the OS credential store."""
        store = self._available_keyring()
        try:
            value = store.get_password(self.service_name, account)
        except KeyringError as exc:
            raise CredentialStoreError(
                "Scout could not read from the OS credential store."
            ) from exc
        return value.strip() if isinstance(value, str) and value.strip() else None

    def delete_secret(self, account: str) -> bool:
        """Delete one secret from the OS credential store."""
        store = self._available_keyring()
        if self.load_secret(account) is None:
            return False
        try:
            store.delete_password(self.service_name, account)
        except KeyringError as exc:
            raise CredentialStoreError(
                "Scout could not delete from the OS credential store."
            ) from exc
        return True

    def _available_keyring(self) -> KeyringModule:
        """Return keyring when the active backend is a real credential store."""
        try:
            backend = self.keyring_module.get_keyring()
        except KeyringError as exc:
            raise CredentialStoreError("Scout could not inspect the OS credential store.") from exc

        backend_type = type(backend)
        backend_name = f"{backend_type.__module__}.{backend_type.__name__}"
        priority = getattr(backend, "priority", None)
        if backend_name in {"keyring.backends.fail.Keyring", "keyring.backends.null.Keyring"}:
            raise CredentialStoreError(
                "No OS credential store is available. Configure macOS Keychain, "
                "Windows Credential Manager, or Linux Secret Service and try again."
            )
        if isinstance(priority, int | float) and priority <= 0:
            raise CredentialStoreError(
                "No OS credential store is available. Configure macOS Keychain, "
                "Windows Credential Manager, or Linux Secret Service and try again."
            )
        return self.keyring_module
