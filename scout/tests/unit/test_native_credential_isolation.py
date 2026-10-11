"""Repository checks must never consult a developer's native credentials."""

import pytest

from atlas_scout.credentials import SystemCredentialStore


def test_suite_refuses_native_credential_access() -> None:
    """Missing dependency injection fails before consulting native keyring."""
    with pytest.raises(AssertionError, match="native access is forbidden"):
        SystemCredentialStore().load_secret("test-must-not-touch-user-keychain")
