from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import patch

import pytest

from atlas.platform.mcp import server as server_module

if TYPE_CHECKING:
    from collections.abc import Iterator

    from atlas.config import Settings


@pytest.fixture
def patched_settings(test_settings: Settings) -> Iterator[Settings]:
    """Patch `get_settings` inside the MCP server module to use the test DB."""
    with patch.object(server_module, "get_settings", return_value=test_settings):
        yield test_settings
