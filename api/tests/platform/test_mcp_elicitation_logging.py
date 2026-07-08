"""Tests for Atlas MCP elicitation helpers."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from atlas.platform.mcp.elicitation import (
    log_elicitation_event,
)


class TestElicitationLogging:
    @pytest.mark.asyncio
    async def test_lifecycle_log_omits_content(self) -> None:
        with patch("atlas.platform.mcp.elicitation.log_operation", new=AsyncMock()) as log_mock:
            await log_elicitation_event(
                interaction="discovery_run_preflight",
                mode="form",
                action="decline",
            )

        log_mock.assert_awaited_once()
        kwargs = log_mock.await_args.kwargs
        assert kwargs["logger"] == "atlas.mcp.elicitation"
        assert kwargs["message"] == (
            "The user declined the elicitation; Atlas used the safe fallback. "
            "(discovery run preflight)"
        )
        assert kwargs["interaction"] == "discovery_run_preflight"
        assert kwargs["mode"] == "form"
        assert kwargs["action"] == "decline"
        assert kwargs["next_step"] == "use_safe_fallback"
        assert "content" not in kwargs
        assert "location_query" not in kwargs
        assert "issue_areas" not in kwargs

    @pytest.mark.asyncio
    async def test_unavailable_log_is_generic(self) -> None:
        with patch("atlas.platform.mcp.elicitation.log_operation", new=AsyncMock()) as log_mock:
            await log_elicitation_event(
                interaction="url_completion_notification",
                mode="url",
                action="unavailable",
            )

        assert log_mock.await_args.kwargs["message"] == (
            "Atlas could not complete the elicitation update. (URL completion notification)"
        )
