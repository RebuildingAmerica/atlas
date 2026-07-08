"""Shared helpers for app factory tests."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING
from unittest.mock import MagicMock

import pytest

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable


@pytest.fixture
def patch_mcp_session_manager(monkeypatch: pytest.MonkeyPatch) -> Callable[[], None]:
    """Patch the MCP session manager with a no-op runner."""

    def apply_patch() -> None:
        @asynccontextmanager
        async def run() -> AsyncIterator[None]:
            yield

        session_manager = MagicMock()
        session_manager.run = run
        mcp = MagicMock()
        mcp.session_manager = session_manager
        monkeypatch.setattr("atlas.main.get_mcp", lambda: mcp)

    return apply_patch
