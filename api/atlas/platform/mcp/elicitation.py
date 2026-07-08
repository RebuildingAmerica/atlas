"""MCP elicitation helpers for Atlas.

Atlas treats elicitation as an explicit user-decision layer. This module keeps
the low-level protocol rules small and testable before product flows wire them
into tools or prompts.
"""

from __future__ import annotations

from atlas.platform.config import get_settings

from .elicitation_clarification import (
    _apply_search_entities_clarification,
    _filter_issue_area_payload,
    _has_value,
    _issue_match_score,
    _issue_match_slug,
    _should_elicit_issue_area_selection,
    clarify_place_argument,
    clarify_resolve_issue_areas_result,
    clarify_search_entities_arguments,
    should_elicit_place_clarification,
    should_elicit_search_entities_clarification,
)
from .elicitation_core import (
    _URL_ELICITATION_STATES,
    CLIENT_CAPABILITIES_META_KEY,
    URL_ELICITATION_REQUIRED,
    ElicitationMode,
    ElicitationSchemaError,
    PlaceClarification,
    ResolveIssueAreasClarification,
    SearchEntitiesClarification,
    URLElicitationState,
)
from .elicitation_state import (
    build_first_party_elicitation_url,
    complete_url_elicitation_state,
    create_url_elicitation_state,
    declares_elicitation_mode,
    declares_form_elicitation,
    declares_url_elicitation,
    get_url_elicitation_state,
    has_completed_url_elicitation,
)
from .elicitation_validation import (
    build_form_elicitation_request,
    build_url_elicitation_request,
    build_url_elicitation_required_error,
    log_elicitation_event,
    validate_form_requested_schema,
)
from .logging_support import log_operation

__all__ = [
    "CLIENT_CAPABILITIES_META_KEY",
    "URL_ELICITATION_REQUIRED",
    "_URL_ELICITATION_STATES",
    "ElicitationMode",
    "ElicitationSchemaError",
    "PlaceClarification",
    "ResolveIssueAreasClarification",
    "SearchEntitiesClarification",
    "URLElicitationState",
    "_apply_search_entities_clarification",
    "_filter_issue_area_payload",
    "_has_value",
    "_issue_match_score",
    "_issue_match_slug",
    "_should_elicit_issue_area_selection",
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
    "get_settings",
    "get_url_elicitation_state",
    "has_completed_url_elicitation",
    "log_elicitation_event",
    "log_operation",
    "should_elicit_place_clarification",
    "should_elicit_search_entities_clarification",
    "validate_form_requested_schema",
]
