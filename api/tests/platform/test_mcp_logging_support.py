"""Tests for the MCP logging capability: setLevel + structured notifications."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from mcp import types

from atlas.platform.mcp import logging_support
from atlas.platform.mcp.logging_support import (
    _handle_set_level,
    current_min_level,
    current_session,
    install_logging_extension,
    log_operation,
)
from atlas.platform.mcp.server import build_mcp


@pytest.fixture(autouse=True)
def _reset_min_level() -> None:
    """_min_log_level is process-global state; keep tests independent."""
    logging_support._min_log_level = "info"  # noqa: SLF001
    yield
    logging_support._min_log_level = "info"  # noqa: SLF001


class TestHandleSetLevel:
    @pytest.mark.asyncio
    async def test_updates_current_min_level(self) -> None:
        await _handle_set_level("debug")
        assert current_min_level() == "debug"

    @pytest.mark.asyncio
    async def test_defaults_to_info(self) -> None:
        assert current_min_level() == "info"


class TestCurrentSession:
    def test_returns_none_outside_request_context(self) -> None:
        assert current_session() is None

    def test_returns_session_within_request_context(self) -> None:
        from mcp.server.lowlevel.server import request_ctx
        from mcp.shared.context import RequestContext

        session = MagicMock()
        ctx = RequestContext(
            request_id=1,
            meta=None,
            session=session,
            lifespan_context=None,
        )
        token = request_ctx.set(ctx)
        try:
            assert current_session() is session
        finally:
            request_ctx.reset(token)


class TestLogOperation:
    @pytest.mark.asyncio
    async def test_sends_when_at_or_above_min_level(self) -> None:
        session = MagicMock()
        session.send_log_message = AsyncMock()

        with patch.object(logging_support, "current_session", return_value=session):
            await log_operation(logger="atlas.mcp.tools", level="info", message="hi", tool="x")

        session.send_log_message.assert_awaited_once()
        _, kwargs = session.send_log_message.call_args
        assert kwargs["level"] == "info"
        assert kwargs["logger"] == "atlas.mcp.tools"
        assert kwargs["data"]["message"] == "hi"
        assert kwargs["data"]["tool"] == "x"

    @pytest.mark.asyncio
    async def test_skips_when_below_min_level(self) -> None:
        logging_support._min_log_level = "error"  # noqa: SLF001
        session = MagicMock()
        session.send_log_message = AsyncMock()

        with patch.object(logging_support, "current_session", return_value=session):
            await log_operation(logger="atlas.mcp.tools", level="debug", message="hi")

        session.send_log_message.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_noop_without_a_session(self) -> None:
        with patch.object(logging_support, "current_session", return_value=None):
            await log_operation(logger="atlas.mcp.tools", level="info", message="hi")

    @pytest.mark.asyncio
    async def test_swallows_send_failures(self) -> None:
        session = MagicMock()
        session.send_log_message = AsyncMock(side_effect=RuntimeError("boom"))

        with patch.object(logging_support, "current_session", return_value=session):
            await log_operation(logger="atlas.mcp.tools", level="info", message="hi")


class TestInstallLoggingExtension:
    def test_registers_set_level_handler(self) -> None:
        mcp = build_mcp()
        install_logging_extension(mcp)
        assert types.SetLevelRequest in mcp._mcp_server.request_handlers  # noqa: SLF001

    def test_advertises_logging_capability(self) -> None:
        mcp = build_mcp()
        install_logging_extension(mcp)
        options = mcp._mcp_server.create_initialization_options()  # noqa: SLF001
        assert options.capabilities.logging is not None

    @pytest.mark.asyncio
    async def test_set_level_request_handler_updates_level(self) -> None:
        mcp = build_mcp()
        install_logging_extension(mcp)
        handler = mcp._mcp_server.request_handlers[types.SetLevelRequest]  # noqa: SLF001

        await handler(
            types.SetLevelRequest(
                method="logging/setLevel", params=types.SetLevelRequestParams(level="warning")
            )
        )

        assert current_min_level() == "warning"
