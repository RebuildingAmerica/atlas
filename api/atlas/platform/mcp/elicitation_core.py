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

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from atlas.taxonomy.issue_areas import ALL_ISSUE_SLUGS

_logger = logging.getLogger("atlas.mcp.elicitation")

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
