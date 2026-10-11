from pathlib import Path
from typing import Never

import keyring
import pytest


@pytest.fixture(autouse=True)
def forbid_native_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    """Protect developers' saved credentials and prevent prompts during tests."""

    def reject(*_args: object, **_kwargs: object) -> Never:
        raise AssertionError(
            "Tests must inject credential-store dependencies; native access is forbidden."
        )

    for operation in (
        "get_keyring",
        "get_password",
        "get_credential",
        "set_password",
        "delete_password",
    ):
        monkeypatch.setattr(keyring, operation, reject)


@pytest.fixture
def fixtures_dir() -> Path:
    return Path(__file__).parent / "fixtures"


@pytest.fixture
def tmp_db_path(tmp_path: Path) -> Path:
    return tmp_path / "test-scout.db"
