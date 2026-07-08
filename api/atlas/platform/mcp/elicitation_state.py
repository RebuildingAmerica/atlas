"""URL and state helpers for `atlas.platform.mcp.elicitation`."""
# ruff: noqa: TRY003

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from urllib.parse import urlencode, urlsplit, urlunsplit

from .elicitation_core import (
    _URL_ELICITATION_STATES,
    _URL_ELICITATION_TTL,
    ElicitationMode,
    URLElicitationLookupStatus,
    URLElicitationState,
    _elicitation_capability,
    _new_elicitation_id,
    _now,
)
from .elicitation_validation import log_elicitation_event

if TYPE_CHECKING:
    from datetime import datetime


def declares_form_elicitation(meta: object | None) -> bool:
    """Return whether request metadata declares form-mode elicitation support.

    The MCP spec treats an empty elicitation capability object as form-mode
    support for backwards compatibility.
    """
    from . import elicitation as elicitation_module

    if not elicitation_module.get_settings().mcp_form_elicitation_enabled:
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
