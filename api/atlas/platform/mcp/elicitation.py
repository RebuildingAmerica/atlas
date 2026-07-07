"""MCP elicitation helpers for Atlas.

Atlas treats elicitation as an explicit user-decision layer. This module keeps
the low-level protocol rules small and testable before product flows wire them
into tools or prompts.
"""
# ruff: noqa: TRY003

from __future__ import annotations

import logging
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal, Protocol, cast
from urllib.parse import urlencode, urlsplit, urlunsplit

from mcp import types
from mcp.shared.exceptions import McpError
from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from atlas.platform.config import get_settings
from atlas.platform.mcp.logging_support import log_operation
from atlas.taxonomy.issue_areas import ALL_ISSUE_SLUGS

_logger = logging.getLogger("atlas.mcp.elicitation")

__all__ = [
    "CLIENT_CAPABILITIES_META_KEY",
    "URL_ELICITATION_REQUIRED",
    "ElicitationMode",
    "ElicitationSchemaError",
    "PlaceClarification",
    "ResolveIssueAreasClarification",
    "SearchEntitiesClarification",
    "URLElicitationState",
    "build_first_party_elicitation_url",
    "build_form_elicitation_request",
    "build_url_elicitation_request",
    "build_url_elicitation_required_error",
    "clarify_place_argument",
    "clarify_resolve_issue_areas_result",
    "clarify_search_entities_arguments",
    "complete_url_elicitation_state",
    "create_url_elicitation_state",
    "declares_elicitation_mode",
    "declares_form_elicitation",
    "declares_url_elicitation",
    "get_url_elicitation_state",
    "has_completed_url_elicitation",
    "log_elicitation_event",
    "should_elicit_place_clarification",
    "should_elicit_search_entities_clarification",
    "validate_form_requested_schema",
]

CLIENT_CAPABILITIES_META_KEY = "io.modelcontextprotocol/clientCapabilities"
URL_ELICITATION_REQUIRED = -32042
type ElicitationMode = Literal["form", "url"]
type URLElicitationLookupStatus = Literal[
    "pending",
    "unknown",
    "expired",
    "already_completed",
]

_SENSITIVE_FIELD_RE = re.compile(
    r"(^|[_\-\s])("
    r"api[_\-\s]?key|"
    r"access[_\-\s]?token|"
    r"auth[_\-\s]?token|"
    r"bearer|"
    r"client[_\-\s]?secret|"
    r"credential|"
    r"password|"
    r"payment|"
    r"private[_\-\s]?key|"
    r"refresh[_\-\s]?token|"
    r"secret|"
    r"token"
    r")($|[_\-\s])",
    re.IGNORECASE,
)

_PRIMITIVE_TYPES = frozenset({"string", "number", "integer", "boolean"})
_AMBIGUOUS_PLACE_NAMES = frozenset({"kansas city", "portland", "springfield", "washington"})
_RESULT_DEPTH_LIMITS = {"quick": 10, "standard": 20, "deep": 50}

type EntityTypeChoice = Literal["person", "organization", "initiative", "campaign", "event"]
type EvidenceThresholdChoice = Literal["any_source_backed", "more_source_backed"]
type ResultDepthChoice = Literal["quick", "standard", "deep"]


def _validate_issue_area_slug(value: str) -> str:
    """Return a valid Atlas issue-area slug or raise a validation error."""
    if value not in ALL_ISSUE_SLUGS:
        raise ValueError("Unknown Atlas issue area slug.")
    return value


IssueAreaSlug = Annotated[str, AfterValidator(_validate_issue_area_slug)]

_INTERACTION_LABELS = {
    "api_key_settings": "API key settings",
    "api_key_settings_url": "API key settings URL",
    "billing_settings": "billing settings",
    "billing_settings_url": "billing settings URL",
    "discovery_run_preflight": "discovery run preflight",
    "issue_area_clarification": "issue area clarification",
    "place_clarification": "place clarification",
    "prompt_missing_argument": "prompt missing argument",
    "prompt_optional_context": "prompt optional context",
    "search_entities_clarification": "search clarification",
    "url_completion_notification": "URL completion notification",
    "workbench_save_list": "Workbench saved-list handoff",
    "workbench_research_brief": "Workbench research-brief handoff",
    "workbench_brief_export": "Workbench brief-export handoff",
    "workbench_coverage_report_export": "Workbench coverage-report export handoff",
    "workbench_coverage_target": "Workbench coverage-target handoff",
    "workbench_watch_resource": "Workbench watch handoff",
}

_ACTION_MESSAGES = {
    "accept": "Atlas applied the elicited user decision.",
    "cancel": "The elicitation was canceled; Atlas did not infer a new decision.",
    "completed": "The URL-mode elicitation completed in Atlas.",
    "decline": "The user declined the elicitation; Atlas used the safe fallback.",
    "expired": "The URL-mode elicitation expired before completion.",
    "identity_mismatch": "The browser actor did not match the MCP caller.",
    "invalid_response": "The elicitation response was invalid; Atlas stopped the action.",
    "requested": "Atlas requested user input to improve the MCP workflow.",
    "already_completed": "Atlas ignored a repeated URL-mode completion.",
    "unavailable": "Atlas could not complete the elicitation update.",
    "unknown": "Atlas could not find the URL-mode elicitation.",
    "unsupported": "The MCP client does not support this elicitation mode.",
}

_ACTION_NEXT_STEPS = {
    "accept": "continue_with_elicited_decision",
    "cancel": "keep_existing_behavior_or_stop_action",
    "completed": "resume_waiting_mcp_request",
    "decline": "use_safe_fallback",
    "expired": "start_new_url_elicitation",
    "identity_mismatch": "reject_completion",
    "invalid_response": "stop_action",
    "requested": "wait_for_user_response",
    "already_completed": "ignore_repeated_completion",
    "unavailable": "use_existing_behavior",
    "unknown": "hide_completion_state",
    "unsupported": "use_existing_behavior",
}

_URL_ELICITATION_TTL = timedelta(minutes=15)
_URL_ELICITATION_ID_BYTES = 16
_URL_ELICITATION_STATES: dict[str, URLElicitationState] = {}
_MIN_AMBIGUOUS_ISSUE_MATCHES = 2
_ISSUE_MATCH_AMBIGUITY_RATIO = 0.5


class ElicitationSchemaError(ValueError):
    """Raised when an Atlas form-mode elicitation schema is unsafe or invalid."""


class PlaceClarification(BaseModel):
    """Form field for resolving an ambiguous place lookup."""

    place: str = Field(
        title="Place",
        description="City and state, state, county, or region.",
        max_length=120,
    )


class SearchEntitiesClarification(BaseModel):
    """Optional form fields for narrowing a broad Atlas entity search."""

    model_config = ConfigDict(extra="forbid")

    place: str | None = Field(
        default=None,
        title="Place",
        description="City and state, or a state.",
        max_length=120,
    )
    text: str | None = Field(
        default=None,
        title="Search phrase",
        description="Issue, organization, person, or initiative name.",
        max_length=160,
    )
    issue_areas: list[IssueAreaSlug] | None = Field(
        default=None,
        title="Issue areas",
        description="Issue areas to prioritize.",
        max_length=5,
    )
    actor_types: list[EntityTypeChoice] | None = Field(
        default=None,
        title="Actor types",
        description="Kinds of civic actors to include.",
        max_length=5,
    )
    result_depth: ResultDepthChoice | None = Field(
        default=None,
        title="Result depth",
        description="How many source-linked results to return.",
    )
    evidence_threshold: EvidenceThresholdChoice | None = Field(
        default=None,
        title="Source backing",
        description="Whether to prioritize results with more public sources.",
    )


class ResolveIssueAreasClarification(BaseModel):
    """Form field for choosing issue areas from ambiguous resolver matches."""

    model_config = ConfigDict(extra="forbid")

    issue_areas: list[IssueAreaSlug] = Field(
        title="Issue areas",
        description="Issue areas that match the user's intent.",
        min_length=1,
        max_length=5,
    )


@dataclass(frozen=True)
class URLElicitationState:
    """Server-side state for an out-of-band URL-mode elicitation."""

    elicitation_id: str
    user_id: str | None
    org_id: str | None
    target_flow: str
    target_url: str
    created_at: datetime
    expires_at: datetime
    session: Any | None = None
    completed_at: datetime | None = None


class ElicitationContext(Protocol):
    """Small subset of FastMCP context Atlas uses for form elicitation."""

    @property
    def request_context(self) -> Any:
        """Return the active MCP request context."""

    async def elicit(
        self,
        *,
        message: str,
        schema: type[BaseModel],
    ) -> Any:
        """Ask the MCP client for structured user input."""


def _schema_error(message: str) -> ElicitationSchemaError:
    return ElicitationSchemaError(message)


def _dump_model(value: object) -> object:
    if hasattr(value, "model_dump"):
        return value.model_dump(by_alias=True, exclude_none=True)
    return value


def _now() -> datetime:
    return datetime.now(UTC)


def _new_elicitation_id() -> str:
    return f"eli_{secrets.token_urlsafe(_URL_ELICITATION_ID_BYTES)}"


def _client_capabilities(meta: object | None) -> dict[str, Any] | None:
    meta = _dump_model(meta)
    if not isinstance(meta, dict):
        return None

    capabilities = _dump_model(meta.get(CLIENT_CAPABILITIES_META_KEY))
    return capabilities if isinstance(capabilities, dict) else None


def _elicitation_capability(meta: object | None) -> dict[str, Any] | None:
    capabilities = _client_capabilities(meta)
    if capabilities is None:
        return None

    elicitation = _dump_model(capabilities.get("elicitation"))
    return elicitation if isinstance(elicitation, dict) else None


def _request_meta_from_context(ctx: object | None) -> object | None:
    if ctx is None:
        return None

    try:
        request_context = cast("ElicitationContext", ctx).request_context
    except ValueError:
        return None

    return getattr(request_context, "meta", None)


def declares_form_elicitation(meta: object | None) -> bool:
    """Return whether request metadata declares form-mode elicitation support.

    The MCP spec treats an empty elicitation capability object as form-mode
    support for backwards compatibility.
    """
    if not get_settings().mcp_form_elicitation_enabled:
        return False
    elicitation = _elicitation_capability(meta)
    if elicitation is None:
        return False
    return elicitation == {} or isinstance(elicitation.get("form"), dict)


def declares_url_elicitation(meta: object | None) -> bool:
    """Return whether request metadata declares URL-mode elicitation support."""
    elicitation = _elicitation_capability(meta)
    return isinstance(elicitation, dict) and isinstance(elicitation.get("url"), dict)


def create_url_elicitation_state(  # noqa: PLR0913
    *,
    user_id: str | None,
    org_id: str | None,
    target_flow: str,
    target_url: str,
    session: Any | None = None,
    now: datetime | None = None,
) -> URLElicitationState:
    """Create short-lived URL-mode state bound to the MCP caller identity."""
    created_at = now or _now()
    state = URLElicitationState(
        elicitation_id=_new_elicitation_id(),
        user_id=user_id,
        org_id=org_id,
        target_flow=target_flow,
        target_url=target_url,
        created_at=created_at,
        expires_at=created_at + _URL_ELICITATION_TTL,
        session=session,
    )
    _URL_ELICITATION_STATES[state.elicitation_id] = state
    return state


def _lookup_url_elicitation_state(
    elicitation_id: str,
) -> tuple[URLElicitationState | None, URLElicitationLookupStatus]:
    state = _URL_ELICITATION_STATES.get(elicitation_id)
    if state is None:
        return None, "unknown"
    if state.completed_at is not None:
        return state, "already_completed"
    if state.expires_at <= _now():
        _URL_ELICITATION_STATES.pop(elicitation_id, None)
        return state, "expired"
    return state, "pending"


def get_url_elicitation_state(elicitation_id: str) -> URLElicitationState | None:
    """Return a pending URL-mode state, or None when unknown, expired, or completed."""
    state, status = _lookup_url_elicitation_state(elicitation_id)
    return state if status == "pending" else None


def has_completed_url_elicitation(
    *,
    target_flow: str,
    user_id: str | None,
    org_id: str | None,
) -> bool:
    """Return whether this caller has completed a URL-mode handoff for the flow."""
    now = _now()
    for state in _URL_ELICITATION_STATES.values():
        if state.target_flow != target_flow or state.completed_at is None:
            continue
        if state.expires_at <= now:
            continue
        if state.user_id != user_id or state.org_id != org_id:
            continue
        return True
    return False


async def complete_url_elicitation_state(
    elicitation_id: str,
    *,
    user_id: str,
    org_id: str | None,
) -> URLElicitationState | None:
    """Complete URL-mode state after verifying the browser actor matches the MCP user."""
    state, status = _lookup_url_elicitation_state(elicitation_id)
    if state is None:
        await log_elicitation_event(
            interaction="url_completion_notification",
            mode="url",
            action=status,
        )
        return None
    if status != "pending":
        await log_elicitation_event(
            interaction=state.target_flow,
            mode="url",
            action=status,
        )
        return None
    if state.user_id is not None and state.user_id != user_id:
        await log_elicitation_event(
            interaction=state.target_flow,
            mode="url",
            action="identity_mismatch",
        )
        return None
    if state.org_id is not None and state.org_id != org_id:
        await log_elicitation_event(
            interaction=state.target_flow,
            mode="url",
            action="identity_mismatch",
        )
        return None

    completed = URLElicitationState(
        elicitation_id=state.elicitation_id,
        user_id=state.user_id,
        org_id=state.org_id,
        target_flow=state.target_flow,
        target_url=state.target_url,
        created_at=state.created_at,
        expires_at=state.expires_at,
        session=state.session,
        completed_at=_now(),
    )
    _URL_ELICITATION_STATES[elicitation_id] = completed
    if state.session is not None:
        try:
            await state.session.send_elicit_complete(elicitation_id=elicitation_id)
        except Exception:
            await log_elicitation_event(
                interaction="url_completion_notification",
                mode="url",
                action="unavailable",
            )
    await log_elicitation_event(
        interaction=state.target_flow,
        mode="url",
        action="completed",
    )
    return completed


def build_first_party_elicitation_url(
    *,
    public_url: str,
    path: str,
    elicitation_id: str,
) -> str:
    """Build an Atlas-controlled URL for URL-mode elicitation."""
    parsed = urlsplit(public_url.rstrip("/"))
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("public_url must be an absolute URL.")

    normalized_path = path if path.startswith("/") else f"/{path}"
    query = urlencode({"mcpElicitationId": elicitation_id})
    return urlunsplit((parsed.scheme, parsed.netloc, normalized_path, query, ""))


def declares_elicitation_mode(meta: object | None, mode: ElicitationMode) -> bool:
    """Return whether request metadata declares the requested elicitation mode."""
    if mode == "form":
        return declares_form_elicitation(meta)
    if mode == "url":
        return declares_url_elicitation(meta)
    raise ValueError("Unsupported elicitation mode.")


def _has_value(value: object | None) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return bool(value)
    return True


def _normalized_ambiguous_place_key(place: str) -> str:
    return place.strip().lower()


def should_elicit_place_clarification(*, place: str) -> bool:
    """Return whether a place string needs user clarification before lookup."""
    stripped_place = place.strip()
    if "," in stripped_place:
        return False
    return _normalized_ambiguous_place_key(stripped_place) in _AMBIGUOUS_PLACE_NAMES


async def clarify_place_argument(
    ctx: ElicitationContext | None,
    *,
    place: str,
) -> str:
    """Ask for a specific place when a place-first read tool is ambiguous."""
    if not should_elicit_place_clarification(place=place):
        return place
    if not declares_form_elicitation(_request_meta_from_context(ctx)):
        await log_elicitation_event(
            interaction="place_clarification",
            mode="form",
            action="unsupported",
        )
        return place

    assert ctx is not None
    await log_elicitation_event(
        interaction="place_clarification",
        mode="form",
        action="requested",
    )
    result = await ctx.elicit(
        message="Choose the specific place for this lookup.",
        schema=PlaceClarification,
    )
    if result.action != "accept":
        await log_elicitation_event(
            interaction="place_clarification",
            mode="form",
            action=result.action,
        )
        return place
    await log_elicitation_event(
        interaction="place_clarification",
        mode="form",
        action="accept",
    )
    return result.data.place.strip() or place


def should_elicit_search_entities_clarification(  # noqa: PLR0913
    *,
    place: str | None,
    issue_areas: list[str] | None,
    text: str | None,
    entity_types: list[str] | None,
    source_types: list[str] | None,
    cursor: str | None,
    allow_place_scoped_clarification: bool = False,
) -> bool:
    """Return whether a search is broad enough to benefit from form clarification."""
    if cursor is not None:
        return False
    scoped_values = (issue_areas, text, entity_types, source_types)
    if allow_place_scoped_clarification and _has_value(place):
        return not any(_has_value(value) for value in scoped_values)
    return not any(_has_value(value) for value in (place, *scoped_values))


def _apply_search_entities_clarification(
    arguments: dict[str, Any],
    clarification: SearchEntitiesClarification,
) -> dict[str, Any]:
    clarified = {**arguments}
    if clarification.place and clarification.place.strip():
        clarified["place"] = clarification.place.strip()
    if clarification.text and clarification.text.strip():
        clarified["text"] = clarification.text.strip()
    if clarification.issue_areas:
        issue_areas = [
            issue.strip() for issue in clarification.issue_areas if issue.strip() in ALL_ISSUE_SLUGS
        ]
        if issue_areas:
            clarified["issue_areas"] = issue_areas
    if clarification.actor_types:
        actor_types = [
            actor_type.strip() for actor_type in clarification.actor_types if actor_type.strip()
        ]
        if actor_types:
            clarified["entity_types"] = actor_types
    if clarification.result_depth:
        clarified["limit"] = _RESULT_DEPTH_LIMITS[clarification.result_depth]
    if clarification.evidence_threshold == "more_source_backed":
        clarified["sort"] = "source_count"
    return clarified


def _issue_match_slug(item: object) -> str | None:
    if not isinstance(item, dict):
        return None
    slug = item.get("slug") or item.get("id")
    return slug if isinstance(slug, str) and slug in ALL_ISSUE_SLUGS else None


def _issue_match_score(item: object) -> float:
    if not isinstance(item, dict):
        return 0.0
    score = item.get("match_score")
    return float(score) if isinstance(score, int | float) else 0.0


def _should_elicit_issue_area_selection(payload: dict[str, Any]) -> bool:
    items = payload.get("items")
    if not isinstance(items, list) or len(items) < _MIN_AMBIGUOUS_ISSUE_MATCHES:
        return False
    scored_items = [item for item in items if _issue_match_slug(item) is not None]
    if len(scored_items) < _MIN_AMBIGUOUS_ISSUE_MATCHES:
        return False
    top_score = _issue_match_score(scored_items[0])
    return (
        top_score > 0
        and _issue_match_score(scored_items[1]) >= top_score * _ISSUE_MATCH_AMBIGUITY_RATIO
    )


def _filter_issue_area_payload(
    payload: dict[str, Any],
    selected_slugs: list[IssueAreaSlug],
) -> dict[str, Any]:
    selected = {slug for slug in selected_slugs if slug in ALL_ISSUE_SLUGS}
    if not selected:
        return payload
    items = payload.get("items")
    if not isinstance(items, list):
        return payload
    filtered_items = [
        item for item in items if isinstance(item, dict) and _issue_match_slug(item) in selected
    ]
    if not filtered_items:
        return payload
    return {**payload, "items": filtered_items, "total": len(filtered_items), "next_cursor": None}


async def clarify_resolve_issue_areas_result(
    ctx: ElicitationContext | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Ask the user to choose issue areas when resolver matches are ambiguous."""
    if not _should_elicit_issue_area_selection(payload):
        return payload
    if not declares_form_elicitation(_request_meta_from_context(ctx)):
        await log_elicitation_event(
            interaction="issue_area_clarification",
            mode="form",
            action="unsupported",
        )
        return payload

    assert ctx is not None
    await log_elicitation_event(
        interaction="issue_area_clarification",
        mode="form",
        action="requested",
    )
    result = await ctx.elicit(
        message="Choose the issue areas that match this request.",
        schema=ResolveIssueAreasClarification,
    )
    if result.action != "accept":
        await log_elicitation_event(
            interaction="issue_area_clarification",
            mode="form",
            action=result.action,
        )
        return payload
    await log_elicitation_event(
        interaction="issue_area_clarification",
        mode="form",
        action="accept",
    )
    return _filter_issue_area_payload(payload, result.data.issue_areas)


async def clarify_search_entities_arguments(  # noqa: PLR0913
    ctx: ElicitationContext | None,
    *,
    place: str | None,
    issue_areas: list[str] | None,
    text: str | None,
    entity_types: list[str] | None,
    source_types: list[str] | None,
    limit: int,
    cursor: str | None,
    allow_place_scoped_clarification: bool = False,
) -> dict[str, Any]:
    """Ask for optional search narrowing when the client supports form elicitation."""
    arguments: dict[str, Any] = {
        "place": place,
        "issue_areas": issue_areas,
        "text": text,
        "entity_types": entity_types,
        "source_types": source_types,
        "limit": limit,
        "cursor": cursor,
    }
    if not should_elicit_search_entities_clarification(
        place=place,
        issue_areas=issue_areas,
        text=text,
        entity_types=entity_types,
        source_types=source_types,
        cursor=cursor,
        allow_place_scoped_clarification=allow_place_scoped_clarification,
    ):
        return arguments
    if not declares_form_elicitation(_request_meta_from_context(ctx)):
        await log_elicitation_event(
            interaction="search_entities_clarification",
            mode="form",
            action="unsupported",
        )
        return arguments

    assert ctx is not None
    await log_elicitation_event(
        interaction="search_entities_clarification",
        mode="form",
        action="requested",
    )
    result = await ctx.elicit(
        message="Choose a place, search phrase, or source-backing preference for the results.",
        schema=SearchEntitiesClarification,
    )
    if result.action != "accept":
        await log_elicitation_event(
            interaction="search_entities_clarification",
            mode="form",
            action=result.action,
        )
        return arguments
    await log_elicitation_event(
        interaction="search_entities_clarification",
        mode="form",
        action="accept",
    )
    return _apply_search_entities_clarification(arguments, result.data)


async def log_elicitation_event(
    *,
    interaction: str,
    mode: ElicitationMode,
    action: str,
) -> None:
    """Emit privacy-safe elicitation lifecycle telemetry."""
    label = _INTERACTION_LABELS.get(interaction, interaction)
    message = _ACTION_MESSAGES.get(action, "Atlas handled an elicitation event.")
    await log_operation(
        logger="atlas.mcp.elicitation",
        level="info",
        message=f"{message} ({label})",
        interaction=interaction,
        mode=mode,
        action=action,
        next_step=_ACTION_NEXT_STEPS.get(action, "review_elicitation_event"),
    )


def _reject_sensitive_property_name(name: str) -> None:
    normalized = name.replace(".", "_")
    if _SENSITIVE_FIELD_RE.search(normalized):
        _logger.info(
            "Atlas blocked a form-mode elicitation schema that requested sensitive information."
        )
        raise _schema_error(f"Form mode elicitation cannot request sensitive field `{name}`.")


def _ensure_object(value: object, *, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _schema_error(f"{label} must be an object.")
    return cast("dict[str, Any]", value)


def _ensure_string_enum(values: object, *, label: str) -> None:
    if not isinstance(values, list) or not values:
        raise _schema_error(f"{label} must define a non-empty string enum.")
    if not all(isinstance(value, str) for value in values):
        raise _schema_error(f"{label} must define a string enum.")


def _ensure_const_string_options(options: object, *, label: str) -> None:
    if not isinstance(options, list) or not options:
        raise _schema_error(f"{label} must define non-empty string enum options.")
    for option in options:
        option_obj = _ensure_object(option, label=label)
        if not isinstance(option_obj.get("const"), str):
            raise _schema_error(f"{label} must define string enum options.")


def _validate_string_enum_shape(property_schema: dict[str, Any], *, label: str) -> None:
    if "enum" in property_schema:
        _ensure_string_enum(property_schema["enum"], label=label)
    if "oneOf" in property_schema:
        _ensure_const_string_options(property_schema["oneOf"], label=label)


def _validate_array_items(items: object, *, label: str) -> None:
    item_schema = _ensure_object(items, label=f"{label}.items")
    if item_schema.get("type") == "string" and "enum" in item_schema:
        _ensure_string_enum(item_schema["enum"], label=f"{label}.items")
        return
    if "anyOf" in item_schema:
        _ensure_const_string_options(item_schema["anyOf"], label=f"{label}.items")
        return
    raise _schema_error(f"{label} must use string enum array items.")


def _validate_property_schema(name: str, property_schema: object) -> None:
    _reject_sensitive_property_name(name)
    schema = _ensure_object(property_schema, label=name)

    if "properties" in schema:
        raise _schema_error(f"Form mode property `{name}` cannot be nested.")

    property_type = schema.get("type")
    if property_type in _PRIMITIVE_TYPES:
        if property_type == "string":
            _validate_string_enum_shape(schema, label=name)
        return

    if property_type == "array":
        _validate_array_items(schema.get("items"), label=name)
        return

    if "oneOf" in schema:
        _ensure_const_string_options(schema["oneOf"], label=name)
        return

    raise _schema_error(f"Form mode property `{name}` must be a primitive field or string enum.")


def validate_form_requested_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Validate Atlas's restricted form-mode elicitation schema subset."""
    root = _ensure_object(schema, label="requestedSchema")
    if root.get("type") != "object":
        raise _schema_error("requestedSchema.type must be `object`.")

    properties = _ensure_object(root.get("properties"), label="requestedSchema.properties")
    for name, property_schema in properties.items():
        _validate_property_schema(name, property_schema)

    required = root.get("required", [])
    if not isinstance(required, list) or not all(isinstance(field, str) for field in required):
        raise _schema_error("requestedSchema.required must be a list of field names.")

    missing_required = set(required) - set(properties)
    if missing_required:
        fields = ", ".join(sorted(missing_required))
        raise _schema_error(f"requestedSchema.required contains unknown fields: {fields}.")

    return schema


def build_form_elicitation_request(
    *,
    message: str,
    requested_schema: dict[str, Any],
) -> types.ElicitRequest:
    """Build a validated form-mode elicitation/create request."""
    return types.ElicitRequest(
        params=types.ElicitRequestFormParams(
            message=message,
            requestedSchema=validate_form_requested_schema(requested_schema),
        )
    )


def build_url_elicitation_request(
    *,
    message: str,
    url: str,
    elicitation_id: str,
) -> types.ElicitRequest:
    """Build a URL-mode elicitation/create request."""
    return types.ElicitRequest(
        params=types.ElicitRequestURLParams(
            message=message,
            url=url,
            elicitationId=elicitation_id,
        )
    )


def build_url_elicitation_required_error(
    *,
    message: str,
    elicitations: list[types.ElicitRequest],
) -> McpError:
    """Build a JSON-RPC error for requests blocked on URL-mode elicitation."""
    elicitation_payloads: list[dict[str, Any]] = []
    for elicitation in elicitations:
        params = elicitation.params
        if not isinstance(params, types.ElicitRequestURLParams):
            raise TypeError("URLElicitationRequiredError can only include URL elicitations.")
        elicitation_payloads.append(params.model_dump(by_alias=True, exclude_none=True))

    return McpError(
        types.ErrorData(
            code=URL_ELICITATION_REQUIRED,
            message=message,
            data={"elicitations": elicitation_payloads},
        )
    )
