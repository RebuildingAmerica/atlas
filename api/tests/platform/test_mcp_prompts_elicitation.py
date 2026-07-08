"""Tests for Atlas MCP prompts."""

from __future__ import annotations

import pytest
from mcp import types

from atlas.platform.mcp import prompts as prompts_module
from atlas.platform.mcp.server import build_mcp
from tests.platform.mcp_prompts_support import (
    FakePromptMcp,
    FakePromptMcpWithoutContext,
    PromptCandidateMetaModel,
    _elicitation_meta,
    _prompt_candidate_meta,
)


@pytest.mark.asyncio
async def test_missing_args_logs_unavailable_without_request_context() -> None:
    request = types.GetPromptRequest.model_validate(
        {
            "method": "prompts/get",
            "params": {
                "name": "research_place",
                "arguments": {},
                "_meta": _elicitation_meta(),
            },
        }
    )

    arguments = await prompts_module._clarify_prompt_arguments(  # noqa: SLF001
        FakePromptMcpWithoutContext(), request
    )

    assert arguments == {}


@pytest.mark.asyncio
async def test_elicitation_fills_required_arg() -> None:
    """Supported clients can provide a missing required prompt argument in flow."""
    mcp = FakePromptMcp(types.ElicitResult(action="accept", content={"place": " Portland, ME "}))
    request = types.GetPromptRequest.model_validate(
        {
            "method": "prompts/get",
            "params": {
                "name": "research_place",
                "arguments": {},
                "_meta": _elicitation_meta(),
            },
        }
    )

    arguments = await prompts_module._clarify_prompt_arguments(mcp, request)  # noqa: SLF001

    assert arguments == {"place": "Portland, ME"}
    assert mcp.session.calls[0]["message"] == (
        "Provide the missing information for this Atlas prompt."
    )
    schema = mcp.session.calls[0]["requestedSchema"]
    assert schema["required"] == ["place"]
    assert schema["properties"]["place"]["title"] == "Place"


@pytest.mark.asyncio
async def test_elicitation_applies_actor_context() -> None:
    """Supported clients can narrow a broad actor-finding prompt in flow."""
    mcp = FakePromptMcp(
        types.ElicitResult(
            action="accept",
            content={
                "place": " Cleveland, OH ",
                "evidence_threshold": "multiple_independent_sources",
            },
        )
    )
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

    arguments = await prompts_module._clarify_prompt_arguments(mcp, request)  # noqa: SLF001

    assert arguments == {
        "query": "housing",
        "place": "Cleveland, OH",
        "evidence_threshold": "multiple_independent_sources",
    }
    assert mcp.session.calls[0]["message"] == "Choose how to narrow this Atlas prompt."
    schema = mcp.session.calls[0]["requestedSchema"]
    assert schema["properties"]["place"]["title"] == "Place"
    assert schema["properties"]["evidence_threshold"]["oneOf"] == [
        {"const": "any_source_backed_leads", "title": "Any source-backed leads"},
        {"const": "multiple_independent_sources", "title": "Multiple independent sources"},
    ]


@pytest.mark.asyncio
async def test_elicitation_decline_keeps_args() -> None:
    """Declining optional context keeps the prompt usable with current args."""
    mcp = FakePromptMcp(types.ElicitResult(action="decline"))
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

    arguments = await prompts_module._clarify_prompt_arguments(mcp, request)  # noqa: SLF001

    assert arguments == {"query": "housing"}


@pytest.mark.asyncio
async def test_elicitation_applies_coverage_focus() -> None:
    """Coverage-gap prompts can ask whether to focus on a specific issue."""
    mcp = FakePromptMcp(
        types.ElicitResult(action="accept", content={"issue_focus": " public transit "})
    )
    request = types.GetPromptRequest.model_validate(
        {
            "method": "prompts/get",
            "params": {
                "name": "assess_coverage_gaps",
                "arguments": {"place": "Detroit, MI"},
                "_meta": _elicitation_meta(),
            },
        }
    )

    arguments = await prompts_module._clarify_prompt_arguments(mcp, request)  # noqa: SLF001

    assert arguments == {"place": "Detroit, MI", "issue_focus": "public transit"}
    assert mcp.session.calls[0]["message"] == "Choose whether to focus this Atlas prompt."


@pytest.mark.asyncio
async def test_required_arg_decline_keeps_args() -> None:
    """Decline keeps the current prompt path, which later raises missing args."""
    mcp = FakePromptMcp(types.ElicitResult(action="decline"))
    request = types.GetPromptRequest.model_validate(
        {
            "method": "prompts/get",
            "params": {
                "name": "create_research_brief",
                "arguments": {},
                "_meta": _elicitation_meta(),
            },
        }
    )

    arguments = await prompts_module._clarify_prompt_arguments(mcp, request)  # noqa: SLF001

    assert arguments == {}
    assert mcp.session.calls[0]["requestedSchema"]["required"] == ["run_id"]


@pytest.mark.asyncio
async def test_research_brief_uses_run_choices() -> None:
    """Brief prompts can present client-provided completed runs as choices."""
    mcp = FakePromptMcp(types.ElicitResult(action="accept", content={"run_id": "run_kc"}))
    request = types.GetPromptRequest.model_validate(
        {
            "method": "prompts/get",
            "params": {
                "name": "create_research_brief",
                "arguments": {},
                "_meta": _prompt_candidate_meta(),
            },
        }
    )

    arguments = await prompts_module._clarify_prompt_arguments(mcp, request)  # noqa: SLF001

    assert arguments == {"run_id": "run_kc"}
    schema = mcp.session.calls[0]["requestedSchema"]
    assert schema["properties"]["run_id"] == {
        "type": "string",
        "title": "Discovery run ID",
        "description": "Atlas discovery run ID.",
        "oneOf": [
            {"const": "run_kc", "title": "Kansas City tenant power"},
            {"const": "run_lv", "title": "Las Vegas food systems"},
        ],
    }


@pytest.mark.asyncio
async def test_source_trail_uses_actor_choices() -> None:
    """Source-trail prompts can present candidate actors as titled choices."""
    mcp = FakePromptMcp(types.ElicitResult(action="accept", content={"entity": "entry_kc_tenants"}))
    request = types.GetPromptRequest.model_validate(
        {
            "method": "prompts/get",
            "params": {
                "name": "inspect_source_trail",
                "arguments": {},
                "_meta": _prompt_candidate_meta(),
            },
        }
    )

    arguments = await prompts_module._clarify_prompt_arguments(mcp, request)  # noqa: SLF001

    assert arguments == {"entity": "entry_kc_tenants"}
    schema = mcp.session.calls[0]["requestedSchema"]
    assert schema["properties"]["entity"]["oneOf"] == [
        {"const": "entry_kc_tenants", "title": "KC Tenants"},
        {"const": "entry_kc_transit", "title": "KC Transit Riders"},
    ]


@pytest.mark.asyncio
async def test_elicitation_needs_client_support() -> None:
    """Unsupported clients keep static prompt behavior."""
    mcp = FakePromptMcp(types.ElicitResult(action="accept", content={"place": "Detroit, MI"}))
    request = types.GetPromptRequest.model_validate(
        {
            "method": "prompts/get",
            "params": {
                "name": "research_place",
                "arguments": {},
            },
        }
    )

    arguments = await prompts_module._clarify_prompt_arguments(mcp, request)  # noqa: SLF001

    assert arguments == {}
    assert mcp.session.calls == []


def test_initialization_skips_completions() -> None:
    """Atlas supports static prompts without argument completion in v1."""
    mcp = build_mcp()
    options = mcp._mcp_server.create_initialization_options()  # noqa: SLF001

    capabilities = options.capabilities.model_dump(by_alias=True, exclude_none=True)
    assert capabilities["prompts"] == {"listChanged": False}
    assert "completions" not in capabilities


def test_prompt_helpers_cover_optional_and_candidate_edges() -> None:
    assert prompts_module._optional_context("Place", None) == ""  # noqa: SLF001
    assert prompts_module._optional_context("Place", "  ") == ""  # noqa: SLF001
    assert prompts_module._evidence_threshold_context("multiple_independent_sources") == (  # noqa: SLF001
        "\n- Evidence threshold: Multiple independent sources"
    )
    assert prompts_module._evidence_threshold_context("any_source_backed_leads") == (  # noqa: SLF001
        "\n- Evidence threshold: Any source-backed leads"
    )
    assert prompts_module._evidence_threshold_context("unknown") == ""  # noqa: SLF001
    assert prompts_module._tool_sequence("search_entities", "get_entity") == (  # noqa: SLF001
        "`search_entities`, `get_entity`"
    )
    assert prompts_module._params_meta({"_meta": {"ok": True}}) == {"ok": True}  # noqa: SLF001
    assert prompts_module._has_prompt_value(None) is False  # noqa: SLF001
    assert prompts_module._prompt_candidate_choices(None, "entity") == []  # noqa: SLF001
    assert prompts_module._prompt_candidate_choices({}, "entity") == []  # noqa: SLF001
    assert prompts_module._prompt_candidate_choices({"atlas": {}}, "entity") == []  # noqa: SLF001
    assert (
        prompts_module._prompt_candidate_choices(  # noqa: SLF001
            {"atlas": {"promptCandidates": {"entity": "not-list"}}}, "entity"
        )
        == []
    )
    assert prompts_module._prompt_candidate_choices(PromptCandidateMetaModel(), "entity") == [  # noqa: SLF001
        {"const": "entry_plain", "title": "entry_plain"},
        {"const": "entry_titled", "title": "Titled entry"},
        {"const": "entry_without_title", "title": "entry_without_title"},
    ]
    assert (
        prompts_module._prompt_candidate_choices(  # noqa: SLF001
            {"atlas": {"promptCandidates": {"entity": [{"title": "No value"}]}}}, "entity"
        )
        == []
    )
    assert prompts_module._apply_prompt_elicitation_content({"query": "housing"}, None) == {  # noqa: SLF001
        "query": "housing"
    }
    assert prompts_module._apply_prompt_elicitation_content(  # noqa: SLF001
        {"query": "housing"}, {"place": " Detroit ", "limit": 20}
    ) == {"query": "housing", "place": "Detroit"}
