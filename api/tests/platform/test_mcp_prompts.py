"""Tests for Atlas MCP prompts."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from mcp import types
from mcp.shared.exceptions import McpError

from atlas.platform.mcp import prompts as prompts_module
from atlas.platform.mcp.elicitation import CLIENT_CAPABILITIES_META_KEY
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
    mcp: object,
    name: str,
    arguments: dict[str, str] | None = None,
    meta: dict[str, Any] | None = None,
) -> types.GetPromptResult:
    """Call the low-level prompts/get handler."""
    handler = _handler_for(mcp, types.GetPromptRequest)
    request = types.GetPromptRequest.model_validate(
        {
            "method": "prompts/get",
            "params": {
                "name": name,
                "arguments": arguments or {},
                **({"_meta": meta} if meta is not None else {}),
            },
        }
    )
    result = await handler(request)  # type: ignore[operator]
    return result.root


def _elicitation_meta() -> dict[str, Any]:
    return {CLIENT_CAPABILITIES_META_KEY: {"elicitation": {"form": {}}}}


def _prompt_candidate_meta() -> dict[str, Any]:
    meta = _elicitation_meta()
    meta["atlas"] = {
        "promptCandidates": {
            "entity": [
                {"const": "entry_kc_tenants", "title": "KC Tenants"},
                {"const": "entry_kc_transit", "title": "KC Transit Riders"},
            ],
            "run_id": [
                {"const": "run_kc", "title": "Kansas City tenant power"},
                {"const": "run_lv", "title": "Las Vegas food systems"},
            ],
        }
    }
    return meta


class PromptCandidateMetaModel:
    def model_dump(self, *, by_alias: bool) -> dict[str, Any]:
        assert by_alias is True
        return {
            "atlas": {
                "promptCandidates": {
                    "entity": [
                        " entry_plain ",
                        {"const": " entry_titled ", "title": " Titled entry "},
                        {"const": " entry_without_title ", "title": ""},
                        "",
                    ]
                }
            }
        }


class FakePromptElicitationSession:
    def __init__(self, result: types.ElicitResult) -> None:
        self.result = result
        self.calls: list[dict[str, Any]] = []

    async def elicit_form(
        self,
        *,
        message: str,
        requestedSchema: dict[str, Any],  # noqa: N803
        related_request_id: object,
    ) -> types.ElicitResult:
        self.calls.append(
            {
                "message": message,
                "requestedSchema": requestedSchema,
                "related_request_id": related_request_id,
            }
        )
        return self.result


class FakePromptMcp:
    def __init__(self, result: types.ElicitResult) -> None:
        self.session = FakePromptElicitationSession(result)
        self._mcp_server = MagicMock()
        self._mcp_server.request_context = MagicMock(session=self.session, request_id="req_1")


class FakePromptMcpWithoutContext:
    class Server:
        @property
        def request_context(self) -> object:
            raise LookupError

    _mcp_server = Server()


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
async def test_optional_prompt_without_context_keeps_arguments() -> None:
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
