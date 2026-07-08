"""Support helpers for Atlas MCP prompts."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, cast

from mcp import types
from mcp.shared.exceptions import McpError

from atlas.platform.mcp.elicitation import (
    declares_form_elicitation,
    log_elicitation_event,
    validate_form_requested_schema,
)
from atlas.platform.mcp.pagination import decode_cursor, encode_cursor

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

_PROMPTS_PAGE_SIZE = 50

_PROMPT_REQUIRED_FIELDS: dict[str, tuple[str, ...]] = {
    "research_place": ("place",),
    "find_civic_actors": ("query",),
    "inspect_source_trail": ("entity",),
    "assess_coverage_gaps": ("place",),
    "create_research_brief": ("run_id",),
}

_PROMPT_FIELD_TITLES: dict[str, str] = {
    "entity": "Actor",
    "place": "Place",
    "query": "Search query",
    "run_id": "Discovery run ID",
}

_PROMPT_FIELD_DESCRIPTIONS: dict[str, str] = {
    "entity": "The person, organization, initiative, campaign, or event to inspect.",
    "evidence_threshold": "How strict Atlas should be about source support.",
    "issue_focus": "Issue area, topic, or concern to emphasize.",
    "place": "City and state, state, county, or region.",
    "query": "Topic, actor, issue, or concern to search for.",
    "run_id": "Atlas discovery run ID.",
}

_OPTIONAL_PROMPT_FIELDS: dict[str, tuple[str, ...]] = {
    "research_place": ("issue_focus",),
    "find_civic_actors": ("place", "evidence_threshold"),
    "assess_coverage_gaps": ("issue_focus",),
}

_OPTIONAL_PROMPT_MESSAGES: dict[str, str] = {
    "assess_coverage_gaps": "Choose whether to focus this Atlas prompt.",
    "find_civic_actors": "Choose how to narrow this Atlas prompt.",
    "research_place": "Choose whether to focus this Atlas prompt.",
}


def _optional_context(label: str, value: str | None) -> str:
    """Return a prompt line only when the optional value is present."""
    if value is None or not value.strip():
        return ""
    return f"\n- {label}: {value.strip()}"


def _evidence_threshold_context(value: str | None) -> str:
    """Return prompt context for an optional evidence threshold."""
    if value == "multiple_independent_sources":
        return "\n- Evidence threshold: Multiple independent sources"
    if value == "any_source_backed_leads":
        return "\n- Evidence threshold: Any source-backed leads"
    return ""


def _tool_sequence(*tool_names: str) -> str:
    """Format a compact tool sequence for prompt text."""
    return ", ".join(f"`{name}`" for name in tool_names)


def _params_meta(params: object) -> object | None:
    """Return request ``_meta`` from SDK params or raw JSON params."""
    if isinstance(params, dict):
        return params.get("_meta")
    return getattr(params, "meta", None)


def _has_prompt_value(value: str | None) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _prompt_candidate_choices(meta: object | None, field: str) -> list[dict[str, str]]:
    """Return client-provided prompt candidates as JSON Schema oneOf choices."""
    if hasattr(meta, "model_dump"):
        meta = meta.model_dump(by_alias=True)
    if not isinstance(meta, dict):
        return []
    atlas_meta = meta.get("atlas")
    if not isinstance(atlas_meta, dict):
        return []
    prompt_candidates = atlas_meta.get("promptCandidates")
    if not isinstance(prompt_candidates, dict):
        return []
    raw_candidates = prompt_candidates.get(field)
    if not isinstance(raw_candidates, list):
        return []

    choices: list[dict[str, str]] = []
    for raw_candidate in raw_candidates:
        if isinstance(raw_candidate, str) and raw_candidate.strip():
            value = raw_candidate.strip()
            choices.append({"const": value, "title": value})
        elif isinstance(raw_candidate, dict):
            raw_value = raw_candidate.get("const")
            raw_title = raw_candidate.get("title")
            if isinstance(raw_value, str) and raw_value.strip():
                value = raw_value.strip()
                title = (
                    raw_title.strip() if isinstance(raw_title, str) and raw_title.strip() else value
                )
                choices.append({"const": value, "title": title})
    return choices


def _missing_prompt_fields(name: str, arguments: dict[str, str] | None) -> list[str]:
    provided = arguments or {}
    return [
        field
        for field in _PROMPT_REQUIRED_FIELDS.get(name, ())
        if not _has_prompt_value(provided.get(field))
    ]


def _missing_optional_prompt_fields(name: str, arguments: dict[str, str] | None) -> list[str]:
    provided = arguments or {}
    return [
        field
        for field in _OPTIONAL_PROMPT_FIELDS.get(name, ())
        if not _has_prompt_value(provided.get(field))
    ]


def _prompt_field_schema(
    field: str,
    *,
    candidate_choices: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    if candidate_choices:
        return {
            "type": "string",
            "title": _PROMPT_FIELD_TITLES.get(field, field.replace("_", " ").title()),
            "description": _PROMPT_FIELD_DESCRIPTIONS[field],
            "oneOf": candidate_choices,
        }
    if field == "evidence_threshold":
        return {
            "type": "string",
            "title": "Evidence threshold",
            "description": _PROMPT_FIELD_DESCRIPTIONS[field],
            "oneOf": [
                {"const": "any_source_backed_leads", "title": "Any source-backed leads"},
                {
                    "const": "multiple_independent_sources",
                    "title": "Multiple independent sources",
                },
            ],
        }
    return {
        "type": "string",
        "title": _PROMPT_FIELD_TITLES.get(field, field.replace("_", " ").title()),
        "description": _PROMPT_FIELD_DESCRIPTIONS[field],
        "minLength": 1,
        "maxLength": 160,
    }


def _prompt_elicitation_schema(fields: list[str], meta: object | None = None) -> dict[str, Any]:
    """Build a flat form schema for missing prompt arguments."""
    schema = {
        "type": "object",
        "properties": {
            field: _prompt_field_schema(
                field,
                candidate_choices=_prompt_candidate_choices(meta, field),
            )
            for field in fields
        },
        "required": fields,
    }
    return validate_form_requested_schema(schema)


def _optional_prompt_elicitation_schema(fields: list[str]) -> dict[str, Any]:
    """Build a flat form schema for optional prompt narrowing."""
    schema = {
        "type": "object",
        "properties": {field: _prompt_field_schema(field) for field in fields},
    }
    return validate_form_requested_schema(schema)


def _apply_prompt_elicitation_content(
    arguments: dict[str, str] | None,
    content: dict[str, Any] | None,
) -> dict[str, str]:
    """Return prompt arguments with accepted elicitation content applied."""
    clarified = {**(arguments or {})}
    if content is None:
        return clarified
    for field, value in content.items():
        if isinstance(value, str) and value.strip():
            clarified[field] = value.strip()
    return clarified


async def _request_missing_prompt_arguments(
    request_context: Any,
    arguments: dict[str, str] | None,
    missing: list[str],
    meta: object | None,
) -> tuple[bool, dict[str, str] | None]:
    """Ask for required prompt arguments and return whether rendering can continue."""
    await log_elicitation_event(
        interaction="prompt_missing_argument",
        mode="form",
        action="requested",
    )
    result = await request_context.session.elicit_form(
        message="Provide the missing information for this Atlas prompt.",
        requestedSchema=_prompt_elicitation_schema(missing, meta),
        related_request_id=request_context.request_id,
    )
    if result.action != "accept":
        await log_elicitation_event(
            interaction="prompt_missing_argument",
            mode="form",
            action=result.action,
        )
        return False, arguments
    await log_elicitation_event(
        interaction="prompt_missing_argument",
        mode="form",
        action="accept",
    )
    return True, _apply_prompt_elicitation_content(arguments, result.content)


async def _request_optional_prompt_context(
    request_context: Any,
    *,
    name: str,
    arguments: dict[str, str] | None,
    optional: list[str],
) -> dict[str, str] | None:
    """Ask for optional prompt narrowing and preserve current arguments on decline."""
    await log_elicitation_event(
        interaction="prompt_optional_context",
        mode="form",
        action="requested",
    )
    result = await request_context.session.elicit_form(
        message=_OPTIONAL_PROMPT_MESSAGES[name],
        requestedSchema=_optional_prompt_elicitation_schema(optional),
        related_request_id=request_context.request_id,
    )
    if result.action != "accept":
        await log_elicitation_event(
            interaction="prompt_optional_context",
            mode="form",
            action=result.action,
        )
        return arguments
    await log_elicitation_event(
        interaction="prompt_optional_context",
        mode="form",
        action="accept",
    )
    return _apply_prompt_elicitation_content(arguments, result.content)


async def _clarify_prompt_arguments(
    mcp: FastMCP,
    req: types.GetPromptRequest,
) -> dict[str, str] | None:
    """Ask for missing required prompt arguments when form elicitation is supported."""
    missing = _missing_prompt_fields(req.params.name, req.params.arguments)
    optional = _missing_optional_prompt_fields(req.params.name, req.params.arguments)
    if not missing and not optional:
        return req.params.arguments
    if not declares_form_elicitation(_params_meta(req.params)):
        if missing:
            await log_elicitation_event(
                interaction="prompt_missing_argument",
                mode="form",
                action="unsupported",
            )
        return req.params.arguments

    try:
        request_context = mcp._mcp_server.request_context  # noqa: SLF001
    except LookupError:
        if missing:
            await log_elicitation_event(
                interaction="prompt_missing_argument",
                mode="form",
                action="unavailable",
            )
        return req.params.arguments

    clarified = req.params.arguments
    if missing:
        can_continue, clarified = await _request_missing_prompt_arguments(
            request_context,
            req.params.arguments,
            missing,
            _params_meta(req.params),
        )
        if not can_continue:
            return req.params.arguments

    optional = _missing_optional_prompt_fields(req.params.name, clarified)
    if not optional:
        return clarified
    return await _request_optional_prompt_context(
        request_context,
        name=req.params.name,
        arguments=clarified,
        optional=optional,
    )


def _invalid_params(message: str) -> McpError:
    """Return an MCP Invalid params error."""
    return McpError(types.ErrorData(code=types.INVALID_PARAMS, message=message))


def _install_protocol_wrappers(mcp: FastMCP) -> None:
    """Add pagination and MCP-shaped prompt errors around FastMCP prompts."""
    server = mcp._mcp_server  # noqa: SLF001
    original_list_prompts = mcp.list_prompts
    original_get_prompt = mcp.get_prompt

    async def handle_list_prompts(
        req: types.ListPromptsRequest | None,
    ) -> types.ServerResult:
        prompts = await original_list_prompts()
        cursor = req.params.cursor if req is not None and req.params is not None else None
        try:
            offset = decode_cursor(cursor)
        except ValueError as exc:
            raise _invalid_params(str(exc)) from exc

        page = prompts[offset : offset + _PROMPTS_PAGE_SIZE]
        next_offset = offset + _PROMPTS_PAGE_SIZE
        next_cursor = encode_cursor(next_offset) if next_offset < len(prompts) else None
        return types.ServerResult(types.ListPromptsResult(prompts=page, nextCursor=next_cursor))

    async def handle_get_prompt(req: types.GetPromptRequest) -> types.ServerResult:
        try:
            arguments = await _clarify_prompt_arguments(mcp, req)
            result = await original_get_prompt(req.params.name, arguments)
        except ValueError as exc:
            raise _invalid_params(str(exc)) from exc
        return types.ServerResult(result)

    server.request_handlers[types.ListPromptsRequest] = cast("Any", handle_list_prompts)
    server.request_handlers[types.GetPromptRequest] = cast("Any", handle_get_prompt)
