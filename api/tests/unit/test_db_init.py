"""Coverage for the ``python -m atlas.db_init`` entry point."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

from atlas import db_init


def test_main_initializes_the_configured_database(capsys: Any) -> None:
    """The Makefile database targets run this module."""
    with (
        patch.object(db_init, "init_db", new=AsyncMock()) as init,
        patch.object(db_init, "get_settings") as settings,
    ):
        settings.return_value.get_database_url.return_value = "sqlite:///probe.db"
        settings.return_value.database_backend = "sqlite"

        db_init.main()

    init.assert_awaited_once_with("sqlite:///probe.db", backend="sqlite")
    assert "sqlite://" in capsys.readouterr().out
