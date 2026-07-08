"""Tests for the FastMCP server module and bearer-auth middleware."""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlsplit

import pytest
from mcp.shared.exceptions import McpError

from atlas.platform.mcp import server as server_module
from atlas.platform.mcp.elicitation import (
    URL_ELICITATION_REQUIRED,
    complete_url_elicitation_state,
    get_url_elicitation_state,
)
from atlas.platform.mcp.server import (
    build_mcp,
)
from tests.support.mcp_server import (
    FakeUrlContext,
    _url_elicitation_meta,
)

if TYPE_CHECKING:
    from atlas.config import Settings


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tool_name", "helper_name"),
    [
        ("open_billing_settings", "_open_billing_settings_url"),
        ("open_api_key_settings", "_open_api_key_settings_url"),
        ("require_api_key_settings", "_require_api_key_settings_url"),
    ],
)
async def test_account_settings_tools_delegate_to_url_helpers(
    tool_name: str,
    helper_name: str,
) -> None:
    helper = AsyncMock(return_value={"status": "delegated"})

    with patch.object(server_module, helper_name, helper):
        _content, payload = await build_mcp().call_tool(tool_name, {})

    assert payload == {"status": "delegated"}
    helper.assert_awaited_once()


@pytest.mark.asyncio
async def test_url_elicitation_flag_blocks_billing(
    patched_settings: Settings,
) -> None:
    """Operators can roll back URL-mode browser handoffs without URL prompts."""
    patched_settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
    patched_settings.mcp_url_elicitation_enabled = False
    ctx = FakeUrlContext(action="accept", meta=_url_elicitation_meta())

    result = await server_module._open_billing_settings_url(  # noqa: SLF001
        ctx=ctx,
        settings=patched_settings,
    )

    assert result == {
        "status": "unsupported",
        "message": "Open Atlas account settings to manage billing.",
        "path": "/account",
    }
    assert ctx.actions == []


@pytest.mark.asyncio
async def test_account_url_unavailable_hides_config(
    patched_settings: Settings,
) -> None:
    patched_settings.auth_jwt_issuer = ""

    result = await server_module._open_billing_settings_url(  # noqa: SLF001
        ctx=FakeUrlContext(action="accept", meta=_url_elicitation_meta()),
        settings=patched_settings,
    )

    assert result == {
        "status": "unavailable",
        "message": "Atlas account settings are unavailable right now.",
    }


@pytest.mark.asyncio
async def test_billing_uses_atlas_url(
    patched_settings: Settings,
) -> None:
    """URL mode should point at Atlas and bind server-side state to the MCP actor."""
    patched_settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
    ctx = FakeUrlContext(action="accept", meta=_url_elicitation_meta())

    result = await server_module._open_billing_settings_url(  # noqa: SLF001
        ctx=ctx,
        settings=patched_settings,
    )

    assert result["status"] == "accepted"
    elicitation_id = result["elicitation_id"]
    requested = ctx.actions[0]
    assert requested["url"] == (
        f"https://atlas.example.com/account?mcpElicitationId={elicitation_id}"
    )
    assert requested["elicitation_id"] == elicitation_id

    state = get_url_elicitation_state(elicitation_id)
    assert state is not None
    assert state.user_id == "user_1"
    assert state.org_id == "org_1"
    assert state.target_flow == "billing_settings"
    assert state.target_url == "/account"
    assert state.session is ctx.session


@pytest.mark.asyncio
async def test_smoke_url_client(patched_settings: Settings) -> None:
    patched_settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
    ctx = FakeUrlContext(action="accept", meta=_url_elicitation_meta())

    result = await server_module._open_billing_settings_url(  # noqa: SLF001
        ctx=ctx,
        settings=patched_settings,
    )

    assert result["status"] == "accepted"
    assert ctx.actions[0]["message"] == "Open Atlas account settings to manage billing."
    assert ctx.actions[0]["url"].startswith("https://atlas.example.com/account?")


@pytest.mark.asyncio
async def test_billing_decline_not_opened(
    patched_settings: Settings,
) -> None:
    """Declined URL consent should be explicit and non-misleading."""
    patched_settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
    ctx = FakeUrlContext(action="decline", meta=_url_elicitation_meta())

    result = await server_module._open_billing_settings_url(  # noqa: SLF001
        ctx=ctx,
        settings=patched_settings,
    )

    assert result == {
        "status": "decline",
        "message": "Atlas billing settings were not opened.",
    }


@pytest.mark.asyncio
async def test_api_key_settings_uses_atlas_url(
    patched_settings: Settings,
) -> None:
    patched_settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
    ctx = FakeUrlContext(action="accept", meta=_url_elicitation_meta())

    result = await server_module._open_api_key_settings_url(  # noqa: SLF001
        ctx=ctx,
        settings=patched_settings,
    )

    assert result["status"] == "accepted"
    elicitation_id = result["elicitation_id"]
    requested = ctx.actions[0]
    assert requested["url"] == (
        f"https://atlas.example.com/account?mcpElicitationId={elicitation_id}"
    )
    assert requested["elicitation_id"] == elicitation_id

    state = get_url_elicitation_state(elicitation_id)
    assert state is not None
    assert state.user_id == "user_1"
    assert state.org_id == "org_1"
    assert state.target_flow == "api_key_settings"
    assert state.target_url == "/account"
    assert state.session is ctx.session


@pytest.mark.asyncio
async def test_api_key_setup_requires_url_completion(
    patched_settings: Settings,
) -> None:
    patched_settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
    ctx = FakeUrlContext(action="accept", meta=_url_elicitation_meta())

    with pytest.raises(McpError) as exc_info:
        await server_module._require_api_key_settings_url(  # noqa: SLF001
            ctx=ctx,
            settings=patched_settings,
        )

    error = exc_info.value.error
    assert error.code == URL_ELICITATION_REQUIRED
    assert error.message == "Atlas API key setup must be completed in the browser."
    assert error.data is not None
    elicitations = error.data["elicitations"]
    assert len(elicitations) == 1
    elicitation = elicitations[0]
    assert elicitation["mode"] == "url"
    assert elicitation["message"] == "Open Atlas account settings to manage API keys."
    url = urlsplit(elicitation["url"])
    query = parse_qs(url.query)
    assert url.scheme == "https"
    assert url.netloc == "atlas.example.com"
    assert url.path == "/account"
    assert set(query) == {"mcpElicitationId"}
    assert query["mcpElicitationId"] == [elicitation["elicitationId"]]
    assert "user_1" not in elicitation["url"]
    assert "org_1" not in elicitation["url"]

    state = get_url_elicitation_state(elicitation["elicitationId"])
    assert state is not None
    assert state.user_id == "user_1"
    assert state.org_id == "org_1"
    assert state.target_flow == "api_key_settings"
    assert state.target_url == "/account"


@pytest.mark.asyncio
async def test_api_key_setup_needs_url_capability(
    patched_settings: Settings,
) -> None:
    patched_settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
    ctx = FakeUrlContext(action="accept")

    result = await server_module._require_api_key_settings_url(  # noqa: SLF001
        ctx=ctx,
        settings=patched_settings,
    )

    assert result == {
        "status": "unsupported",
        "message": "Open Atlas account settings to manage API keys.",
        "path": "/account",
    }
    assert ctx.actions == []


@pytest.mark.asyncio
async def test_api_key_setup_retry_after_completion(
    patched_settings: Settings,
) -> None:
    patched_settings.auth_jwt_issuer = "https://atlas.example.com/api/auth"
    state = server_module._create_account_elicitation_state(  # noqa: SLF001
        ctx=FakeUrlContext(action="accept", meta=_url_elicitation_meta()),
        target_flow="api_key_settings",
    )
    await complete_url_elicitation_state(
        state.elicitation_id,
        user_id="user_1",
        org_id="org_1",
    )
    ctx = FakeUrlContext(action="accept", meta=_url_elicitation_meta())

    result = await server_module._require_api_key_settings_url(  # noqa: SLF001
        ctx=ctx,
        settings=patched_settings,
    )

    assert result == {
        "status": "ready",
        "message": "Atlas API key settings are ready.",
        "path": "/account",
    }
    assert ctx.actions == []
