"""Tests for Atlas MCP prompts."""

from __future__ import annotations

import pytest
from mcp import types
from mcp.shared.exceptions import McpError

from atlas.platform.mcp import prompts as prompts_module
from atlas.platform.mcp.server import build_mcp
from tests.platform.mcp_prompts_support import (
    EXPECTED_PROMPT_NAMES,
    FakePromptMcpWithoutContext,
    _elicitation_meta,
    _get_prompt,
    _list_prompts,
)


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
                "evidence_threshold": "multiple_independent_sources",
            },
            [
                "worker cooperatives",
                "Cleveland, OH",
                "Multiple independent sources",
                "get_related_entities",
            ],
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
async def test_prompt_catalog_rejects_missing_args() -> None:
    """Missing required prompt arguments should be MCP Invalid params errors."""
    with pytest.raises(McpError) as exc_info:
        await _get_prompt(build_mcp(), "research_place")

    assert exc_info.value.error.code == types.INVALID_PARAMS
    assert "Missing required arguments" in exc_info.value.error.message


@pytest.mark.asyncio
async def test_missing_args_without_context() -> None:
    """Capability metadata alone is not enough without an active request context."""
    with pytest.raises(McpError) as exc_info:
        await _get_prompt(build_mcp(), "research_place", meta=_elicitation_meta())

    assert exc_info.value.error.code == types.INVALID_PARAMS
    assert "Missing required arguments" in exc_info.value.error.message


@pytest.mark.asyncio
async def test_optional_prompt_without_context_keeps_arguments() -> None:
    """Optional args stay in place even when no request context is available."""
    request = types.GetPromptRequest.model_validate(
        {
            "method": "prompts/get",
            "params": {
                "name": "find_civic_actors",
                "arguments": {"query": "housing"},
                "_meta": _elicitation_meta(),
            },
        }
    )

    arguments = await prompts_module._clarify_prompt_arguments(  # noqa: SLF001
        FakePromptMcpWithoutContext(), request
    )

    assert arguments == {"query": "housing"}
