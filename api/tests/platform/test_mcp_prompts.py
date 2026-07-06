"""Tests for Atlas MCP prompts."""

from __future__ import annotations

import pytest
from mcp import types
from mcp.shared.exceptions import McpError

from atlas.platform.mcp.server import build_mcp

EXPECTED_PROMPT_NAMES = {
    "assess_coverage_gaps",
    "create_research_brief",
    "find_civic_actors",
    "inspect_source_trail",
    "research_place",
}


def _handler_for(mcp: object, request_type: type) -> object:
    """Return the low-level request handler registered for a request type."""
    return mcp._mcp_server.request_handlers[request_type]  # type: ignore[attr-defined] # noqa: SLF001


async def _list_prompts(mcp: object, cursor: str | None = None) -> types.ListPromptsResult:
    """Call the low-level prompts/list handler."""
    handler = _handler_for(mcp, types.ListPromptsRequest)
    request = types.ListPromptsRequest.model_validate(
        {"method": "prompts/list", "params": {"cursor": cursor} if cursor is not None else {}}
    )
    result = await handler(request)  # type: ignore[operator]
    return result.root


async def _get_prompt(
    mcp: object, name: str, arguments: dict[str, str] | None = None
) -> types.GetPromptResult:
    """Call the low-level prompts/get handler."""
    handler = _handler_for(mcp, types.GetPromptRequest)
    request = types.GetPromptRequest.model_validate(
        {"method": "prompts/get", "params": {"name": name, "arguments": arguments or {}}}
    )
    result = await handler(request)  # type: ignore[operator]
    return result.root


@pytest.mark.asyncio
async def test_build_mcp_registers_curated_atlas_prompts() -> None:
    """Atlas exposes user-selectable civic research workflows."""
    result = await _list_prompts(build_mcp())

    prompt_names = {prompt.name for prompt in result.prompts}
    assert prompt_names == EXPECTED_PROMPT_NAMES

    research_place = next(prompt for prompt in result.prompts if prompt.name == "research_place")
    assert research_place.title == "Research A Place"
    assert research_place.description is not None
    assert "civic landscape" in research_place.description
    assert research_place.arguments is not None
    assert [(arg.name, arg.required) for arg in research_place.arguments] == [
        ("place", True),
        ("issue_focus", False),
    ]


@pytest.mark.asyncio
async def test_research_place_prompt_guides_source_linked_tool_flow() -> None:
    """The place research prompt should instruct assistants to show trust and sources."""
    result = await _get_prompt(
        build_mcp(),
        "research_place",
        {"place": "Kansas City, MO", "issue_focus": "housing and labor"},
    )

    assert result.description is not None
    assert "civic landscape" in result.description
    assert len(result.messages) == 1

    message = result.messages[0]
    assert message.role == "user"
    assert isinstance(message.content, types.TextContent)
    assert "Kansas City, MO" in message.content.text
    assert "housing and labor" in message.content.text
    assert "get_place_profile" in message.content.text
    assert "search_entities" in message.content.text
    assert "get_entity_sources" in message.content.text
    assert "source" in message.content.text.lower()
    assert "trust" in message.content.text.lower()


@pytest.mark.parametrize(
    ("name", "arguments", "expected_snippets"),
    [
        (
            "research_place",
            {"place": "Boise, ID", "issue_focus": ""},
            ["Boise, ID", "get_place_coverage", "If coverage is thin"],
        ),
        (
            "find_civic_actors",
            {
                "query": "worker cooperatives",
                "place": "Cleveland, OH",
                "issue_focus": "labor",
            },
            ["worker cooperatives", "Cleveland, OH", "get_related_entities"],
        ),
        (
            "inspect_source_trail",
            {"entity": "KC Tenants", "place": "Kansas City, MO"},
            ["KC Tenants", "Place hint", "single-source claims"],
        ),
        (
            "assess_coverage_gaps",
            {"place": "Detroit, MI", "issue_focus": "transportation"},
            ["Detroit, MI", "search_sources", "Atlas coverage gaps"],
        ),
        (
            "create_research_brief",
            {"run_id": "run_123"},
            ["run_123", "research brief", "get_discovery_run", "tentative extracted leads"],
        ),
    ],
)
@pytest.mark.asyncio
async def test_each_prompt_renders_workflow_guidance(
    name: str, arguments: dict[str, str], expected_snippets: list[str]
) -> None:
    """Each Atlas prompt returns concrete guidance for its workflow."""
    result = await _get_prompt(build_mcp(), name, arguments)

    assert len(result.messages) == 1
    message = result.messages[0]
    assert message.role == "user"
    assert isinstance(message.content, types.TextContent)
    for snippet in expected_snippets:
        assert snippet in message.content.text


@pytest.mark.asyncio
async def test_prompt_catalog_rejects_invalid_cursor_as_invalid_params() -> None:
    """prompts/list cursor errors should be protocol errors, not silent first pages."""
    with pytest.raises(McpError) as exc_info:
        await _list_prompts(build_mcp(), cursor="not-a-cursor")

    assert exc_info.value.error.code == types.INVALID_PARAMS
    assert "Invalid cursor" in exc_info.value.error.message


@pytest.mark.asyncio
async def test_prompt_catalog_rejects_unknown_prompt_as_invalid_params() -> None:
    """Unknown prompt names should be MCP Invalid params errors."""
    with pytest.raises(McpError) as exc_info:
        await _get_prompt(build_mcp(), "not_an_atlas_prompt")

    assert exc_info.value.error.code == types.INVALID_PARAMS
    assert "Unknown prompt" in exc_info.value.error.message


@pytest.mark.asyncio
async def test_prompt_catalog_rejects_missing_required_arguments_as_invalid_params() -> None:
    """Missing required prompt arguments should be MCP Invalid params errors."""
    with pytest.raises(McpError) as exc_info:
        await _get_prompt(build_mcp(), "research_place")

    assert exc_info.value.error.code == types.INVALID_PARAMS
    assert "Missing required arguments" in exc_info.value.error.message


def test_initialization_advertises_static_prompts_without_completion() -> None:
    """Atlas supports static prompts without argument completion in v1."""
    mcp = build_mcp()
    options = mcp._mcp_server.create_initialization_options()  # noqa: SLF001

    capabilities = options.capabilities.model_dump(by_alias=True, exclude_none=True)
    assert capabilities["prompts"] == {"listChanged": False}
    assert "completions" not in capabilities
