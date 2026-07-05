"""Scout credential-store tests."""

from __future__ import annotations

import pytest

from atlas_scout.credentials import CredentialStoreError, SystemCredentialStore


class AvailableKeyring:
    """Test keyring backend with a positive priority."""

    priority = 1


class MemoryKeyringModule:
    """Minimal keyring module fake."""

    def __init__(self, backend: object) -> None:
        self.backend = backend
        self.secrets: dict[tuple[str, str], str] = {}

    def get_keyring(self) -> object:
        return self.backend

    def set_password(self, service_name: str, username: str, password: str) -> None:
        self.secrets[(service_name, username)] = password

    def get_password(self, service_name: str, username: str) -> str | None:
        return self.secrets.get((service_name, username))

    def delete_password(self, service_name: str, username: str) -> None:
        self.secrets.pop((service_name, username), None)


def test_system_credential_store_round_trips_secret() -> None:
    """The system store delegates secret operations to the active keyring."""
    keyring_module = MemoryKeyringModule(AvailableKeyring())
    store = SystemCredentialStore(service_name="atlas-test", keyring_module=keyring_module)

    store.save_secret("session-token", " secret-token ")

    assert store.load_secret("session-token") == "secret-token"
    assert store.delete_secret("session-token")
    assert store.load_secret("session-token") is None


def test_system_credential_store_rejects_blank_secret() -> None:
    """Blank values should not become stored credentials."""
    store = SystemCredentialStore(
        service_name="atlas-test",
        keyring_module=MemoryKeyringModule(AvailableKeyring()),
    )

    with pytest.raises(CredentialStoreError, match="required"):
        store.save_secret("session-token", " ")


def test_system_credential_store_rejects_null_keyring() -> None:
    """Null keyring backends are not acceptable credential stores."""
    null_keyring = type("Keyring", (), {"__module__": "keyring.backends.null", "priority": 1})
    store = SystemCredentialStore(
        service_name="atlas-test",
        keyring_module=MemoryKeyringModule(null_keyring()),
    )

    with pytest.raises(CredentialStoreError, match="No OS credential store"):
        store.load_secret("session-token")


def test_system_credential_store_rejects_low_priority_keyring() -> None:
    """Disabled keyring backends are not acceptable credential stores."""
    low_priority_keyring = type("LowPriorityKeyring", (), {"priority": 0})
    store = SystemCredentialStore(
        service_name="atlas-test",
        keyring_module=MemoryKeyringModule(low_priority_keyring()),
    )

    with pytest.raises(CredentialStoreError, match="No OS credential store"):
        store.load_secret("session-token")
