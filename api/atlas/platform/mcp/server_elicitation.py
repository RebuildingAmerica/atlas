"""Atlas MCP elicitation and account-handoff helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from .elicitation import (
    build_first_party_elicitation_url,
    build_url_elicitation_request,
    build_url_elicitation_required_error,
    create_url_elicitation_state,
    declares_url_elicitation,
    has_completed_url_elicitation,
    log_elicitation_event,
)

if TYPE_CHECKING:
    from mcp.server.fastmcp import Context

    from atlas.platform.config import Settings
    from atlas.platform.mcp.data import AtlasDataService


@dataclass(frozen=True)
class AccountElicitationFlow:
    """User-facing copy and routing metadata for account URL handoffs."""

    interaction: str
    target_flow: str
    target_path: str
    request_message: str
    fallback_message: str
    declined_message: str
    accepted_message: str
    unavailable_message: str


API_KEY_SETTINGS_FLOW = AccountElicitationFlow(
    interaction="api_key_settings_url",
    target_flow="api_key_settings",
    target_path="/account",
    request_message="Open Atlas account settings to manage API keys.",
    fallback_message="Open Atlas account settings to manage API keys.",
    declined_message="Atlas API key settings were not opened.",
    accepted_message="Atlas API key settings opened in the browser.",
    unavailable_message="Atlas account settings are unavailable right now.",
)

BILLING_SETTINGS_FLOW = AccountElicitationFlow(
    interaction="billing_settings_url",
    target_flow="billing_settings",
    target_path="/account",
    request_message="Open Atlas account settings to manage billing.",
    fallback_message="Open Atlas account settings to manage billing.",
    declined_message="Atlas billing settings were not opened.",
    accepted_message="Atlas billing settings opened in the browser.",
    unavailable_message="Atlas account settings are unavailable right now.",
)


def _origin_and_host(value: str) -> tuple[str | None, str | None]:
    parsed = urlsplit(value.rstrip("/"))
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None, None
    return f"{parsed.scheme}://{parsed.netloc}", parsed.netloc


def _atlas_public_origin(settings: Settings) -> str | None:
    """Return Atlas's public app origin, derived from the configured auth issuer."""
    origin = settings.auth_jwt_issuer.removesuffix("/api/auth")
    return origin or None


def _build_data_service() -> AtlasDataService:
    """Construct an AtlasDataService wired with the current request's settings."""
    from .data import AtlasDataService
    from .server import get_settings

    settings = get_settings()
    return AtlasDataService(settings.database_url, public_url=_atlas_public_origin(settings))


def _actor_claims_from_context(ctx: Context[Any, Any, Any] | None) -> tuple[str | None, str | None]:
    """Return (org_id, user_id) from the verified MCP request payload."""
    if ctx is None:
        return None, None
    try:
        request = ctx.request_context.request
    except ValueError:
        return None, None
    if request is None:
        return None, None
    payload = getattr(request.state, "mcp_auth_payload", None)
    from .auth_middleware import _string_claim

    return _string_claim(payload, "org_id"), _string_claim(payload, "sub")


def _request_context_and_meta(
    ctx: Context[Any, Any, Any] | None,
) -> tuple[Any | None, object | None]:
    try:
        request_context = ctx.request_context if ctx is not None else None
        request_meta = request_context.meta if request_context is not None else None
    except ValueError:
        return None, None
    return request_context, request_meta


def _create_account_elicitation_state(
    *,
    ctx: Context[Any, Any, Any] | None,
    target_flow: str,
    target_url: str = "/account",
) -> Any:
    org_id, user_id = _actor_claims_from_context(ctx)
    request_context, _request_meta = _request_context_and_meta(ctx)
    return create_url_elicitation_state(
        user_id=user_id,
        org_id=org_id,
        target_flow=target_flow,
        target_url=target_url,
        session=getattr(request_context, "session", None),
    )


async def _open_account_url(
    *,
    ctx: Context[Any, Any, Any] | None,
    settings: Settings,
    flow: AccountElicitationFlow,
) -> dict[str, Any]:
    """Use URL-mode elicitation to open a first-party Atlas account surface."""
    public_origin = _atlas_public_origin(settings)
    if public_origin is None:
        return {"status": "unavailable", "message": flow.unavailable_message}
    if not settings.mcp_url_elicitation_enabled:
        await log_elicitation_event(
            interaction=flow.interaction,
            mode="url",
            action="unsupported",
        )
        return {
            "status": "unsupported",
            "message": flow.fallback_message,
            "path": flow.target_path,
        }

    _request_context, request_meta = _request_context_and_meta(ctx)
    if not declares_url_elicitation(request_meta):
        await log_elicitation_event(
            interaction=flow.interaction,
            mode="url",
            action="unsupported",
        )
        return {
            "status": "unsupported",
            "message": flow.fallback_message,
            "path": flow.target_path,
        }

    assert ctx is not None
    state = _create_account_elicitation_state(
        ctx=ctx,
        target_flow=flow.target_flow,
        target_url=flow.target_path,
    )
    url = build_first_party_elicitation_url(
        public_url=public_origin,
        path=flow.target_path,
        elicitation_id=state.elicitation_id,
    )
    await log_elicitation_event(
        interaction=flow.interaction,
        mode="url",
        action="requested",
    )
    result = await ctx.elicit_url(
        message=flow.request_message,
        url=url,
        elicitation_id=state.elicitation_id,
    )
    if result.action != "accept":
        await log_elicitation_event(
            interaction=flow.interaction,
            mode="url",
            action=result.action,
        )
        return {"status": result.action, "message": flow.declined_message}

    await log_elicitation_event(
        interaction=flow.interaction,
        mode="url",
        action="accept",
    )
    return {
        "status": "accepted",
        "message": flow.accepted_message,
        "elicitation_id": state.elicitation_id,
    }


async def _open_billing_settings_url(
    *,
    ctx: Context[Any, Any, Any] | None,
    settings: Settings,
) -> dict[str, Any]:
    return await _open_account_url(ctx=ctx, settings=settings, flow=BILLING_SETTINGS_FLOW)


async def _open_api_key_settings_url(
    *,
    ctx: Context[Any, Any, Any] | None,
    settings: Settings,
) -> dict[str, Any]:
    return await _open_account_url(ctx=ctx, settings=settings, flow=API_KEY_SETTINGS_FLOW)


async def _require_api_key_settings_url(
    *,
    ctx: Context[Any, Any, Any] | None,
    settings: Settings,
) -> dict[str, Any]:
    public_origin = _atlas_public_origin(settings)
    if public_origin is None:
        return {
            "status": "unavailable",
            "message": API_KEY_SETTINGS_FLOW.unavailable_message,
        }
    request_context, request_meta = _request_context_and_meta(ctx)
    org_id, user_id = _actor_claims_from_context(ctx)
    if has_completed_url_elicitation(
        target_flow=API_KEY_SETTINGS_FLOW.target_flow,
        user_id=user_id,
        org_id=org_id,
    ):
        return {
            "status": "ready",
            "message": "Atlas API key settings are ready.",
            "path": "/account",
        }
    if not settings.mcp_url_elicitation_enabled or not declares_url_elicitation(request_meta):
        await log_elicitation_event(
            interaction=API_KEY_SETTINGS_FLOW.interaction,
            mode="url",
            action="unsupported",
        )
        return {
            "status": "unsupported",
            "message": API_KEY_SETTINGS_FLOW.fallback_message,
            "path": "/account",
        }

    state = create_url_elicitation_state(
        user_id=user_id,
        org_id=org_id,
        target_flow=API_KEY_SETTINGS_FLOW.target_flow,
        target_url="/account",
        session=getattr(request_context, "session", None),
    )
    url = build_first_party_elicitation_url(
        public_url=public_origin,
        path="/account",
        elicitation_id=state.elicitation_id,
    )
    await log_elicitation_event(
        interaction=API_KEY_SETTINGS_FLOW.interaction,
        mode="url",
        action="requested",
    )
    raise build_url_elicitation_required_error(
        message="Atlas API key setup must be completed in the browser.",
        elicitations=[
            build_url_elicitation_request(
                message=API_KEY_SETTINGS_FLOW.request_message,
                url=url,
                elicitation_id=state.elicitation_id,
            )
        ],
    )
