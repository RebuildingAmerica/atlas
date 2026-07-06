"""Tests for MCP bearer-auth helper branches."""
# ruff: noqa

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from atlas.config import Settings
from atlas.platform.mcp import auth_middleware as mcp_auth


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"permissions": {"discovery": ["read"]}}, True),
        ({"scope": "discovery:read api.mcp"}, True),
        ({"scope": ["api.mcp", "discovery:read"]}, True),
        ({"scopes": ["api.mcp", "discovery:read"]}, True),
        ({}, False),
        ({"scope": "api.mcp"}, False),
        ("not-a-payload", False),
    ],
)
def test_has_discovery_read_scope_supports_all_claim_shapes(
    payload: object,
    expected: bool,
) -> None:
    """Read scope detection should accept every token shape Atlas emits."""
    assert mcp_auth._has_discovery_read_scope(payload) is expected


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"permissions": {"discovery": ["write"]}}, True),
        ({"scope": "discovery:write api.mcp"}, True),
        ({"scope": ["api.mcp", "discovery:write"]}, True),
        ({"scopes": ["api.mcp", "discovery:write"]}, True),
        ({}, False),
        ({"scope": "api.mcp"}, False),
        ("not-a-payload", False),
    ],
)
def test_has_discovery_write_scope_supports_all_claim_shapes(
    payload: object,
    expected: bool,
) -> None:
    """Write scope detection should accept every token shape Atlas emits."""
    assert mcp_auth._has_discovery_write_scope(payload) is expected


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("body", "expected"),
    [
        (RuntimeError("boom"), None),
        ({"method": "notifications/initialized"}, None),
        ({"method": "tools/call", "params": "bad"}, None),
        ({"method": "tools/call", "params": {"name": "search_entities"}}, None),
        (
            {"method": "tools/call", "params": {"name": "start_discovery_run"}},
            "start_discovery_run",
        ),
    ],
)
async def test_requested_write_tool_name_ignores_non_write_calls(
    body: object,
    expected: str | None,
) -> None:
    """Only tools/call requests for explicit write tools should be flagged."""
    request = AsyncMock()
    if isinstance(body, RuntimeError):
        request.json.side_effect = body
    else:
        request.json = AsyncMock(return_value=body)

    assert await mcp_auth._requested_write_tool_name(request) == expected


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"capabilities": ["api.mcp"]}, True),
        ({"capabilities": []}, False),
        ({"capabilities": "api.mcp"}, False),
        ("not-a-payload", False),
    ],
)
def test_has_mcp_package_access_checks_capabilities(payload: object, expected: bool) -> None:
    """Package access should come from Atlas capabilities, not token shape."""
    assert mcp_auth._has_mcp_package_access(payload) is expected


@pytest.mark.parametrize(
    ("payload", "key", "expected"),
    [
        ({"sub": "user-123"}, "sub", "user-123"),
        ({"sub": ""}, "sub", None),
        ({}, "sub", None),
        ("not-a-payload", "sub", None),
    ],
)
def test_string_claim_extracts_only_non_empty_strings(
    payload: object,
    key: str,
    expected: str | None,
) -> None:
    """String claims should be preserved without coercion."""
    assert mcp_auth._string_claim(payload, key) == expected


@pytest.mark.parametrize(
    ("response", "expected"),
    [
        (SimpleNamespace(status_code=200), True),
        (SimpleNamespace(status_code=404), False),
        (SimpleNamespace(status_code="200"), False),
        (SimpleNamespace(), False),
    ],
)
def test_response_succeeded_uses_numeric_status_codes(
    response: object,
    expected: bool,
) -> None:
    """Only 2xx/3xx responses should count as successful MCP usage."""
    assert mcp_auth._response_succeeded(response) is expected


@pytest.mark.asyncio
async def test_record_successful_mcp_usage_skips_payloads_without_org_id(
    test_settings: Settings,
) -> None:
    """Usage tracking should exit cleanly when the JWT lacks an org context."""
    request = SimpleNamespace(method="POST", url=SimpleNamespace(path="/mcp"))
    response = SimpleNamespace(status_code=200)
    with patch("atlas.platform.mcp.auth_middleware.get_db_connection") as db_mock:
        await mcp_auth._record_successful_mcp_usage(
            test_settings,
            payload={"sub": "user-123"},
            request=request,
            response=response,
        )

    db_mock.assert_not_called()
