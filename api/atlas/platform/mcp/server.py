"""FastMCP server exposing Atlas catalog tools over Streamable HTTP."""

from __future__ import annotations

import contextlib
from typing import TYPE_CHECKING

from starlette.middleware.cors import CORSMiddleware

from atlas.platform.config import get_settings

from .auth_middleware import McpBearerAuthMiddleware
from .elicitation import (
    clarify_place_argument,
    clarify_resolve_issue_areas_result,
    clarify_search_entities_arguments,
)
from .server_elicitation import (  # noqa: F401
    API_KEY_SETTINGS_FLOW,
    BILLING_SETTINGS_FLOW,
    AccountElicitationFlow,
    _actor_claims_from_context,
    _atlas_public_origin,
    _build_data_service,
    _create_account_elicitation_state,
    _open_api_key_settings_url,
    _open_billing_settings_url,
    _origin_and_host,
    _request_context_and_meta,
    _require_api_key_settings_url,
)
from .server_tools import build_mcp
from .server_transport import build_transport_security_settings, split_cors_origins
from .tasks import DraftTasksJsonRpcMiddleware
from .workbench import (
    create_coverage_target as create_coverage_target_handoff,
)
from .workbench import (
    create_research_brief as create_research_brief_handoff,
)
from .workbench import (
    export_coverage_report as export_coverage_report_handoff,
)
from .workbench import (
    export_research_brief as export_research_brief_handoff,
)
from .workbench import (
    save_entities_to_list as save_entities_to_list_handoff,
)
from .workbench import (
    sync_scout_artifacts as sync_scout_artifacts_handoff,
)
from .workbench import (
    watch_workspace_resource as watch_workspace_resource_handoff,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from mcp.server.fastmcp import FastMCP
    from mcp.server.transport_security import TransportSecuritySettings
    from starlette.applications import Starlette

__all__ = [
    "_build_data_service",
    "_open_api_key_settings_url",
    "_open_billing_settings_url",
    "_require_api_key_settings_url",
    "build_mcp",
    "build_transport_security_settings",
    "clarify_place_argument",
    "clarify_resolve_issue_areas_result",
    "clarify_search_entities_arguments",
    "create_coverage_target_handoff",
    "create_research_brief_handoff",
    "export_coverage_report_handoff",
    "export_research_brief_handoff",
    "get_mcp",
    "get_mcp_asgi_app",
    "get_settings",
    "mcp_session_lifespan",
    "save_entities_to_list_handoff",
    "split_cors_origins",
    "sync_scout_artifacts_handoff",
    "watch_workspace_resource_handoff",
]

_CORS_ALLOWED_METHODS = ["GET", "POST", "OPTIONS"]
_mcp: FastMCP | None = None


def get_mcp() -> FastMCP:
    global _mcp  # noqa: PLW0603
    if _mcp is None:
        _mcp = build_mcp()
    return _mcp


def get_mcp_asgi_app(
    transport_security: TransportSecuritySettings | None = None,
) -> Starlette:
    app = get_mcp().streamable_http_app()
    if not getattr(app.state, "atlas_mcp_asgi_middleware_installed", False):
        app.add_middleware(DraftTasksJsonRpcMiddleware)
        app.add_middleware(McpBearerAuthMiddleware)

        if transport_security is None:
            transport_security = build_transport_security_settings(get_settings())
        exact_origins, origin_regex = split_cors_origins(transport_security.allowed_origins)
        app.add_middleware(
            CORSMiddleware,
            allow_origins=exact_origins,
            allow_origin_regex=origin_regex,
            allow_methods=_CORS_ALLOWED_METHODS,
            allow_headers=["*"],
        )
        app.state.atlas_mcp_asgi_middleware_installed = True
    return app


@contextlib.asynccontextmanager
async def mcp_session_lifespan() -> AsyncIterator[None]:
    async with get_mcp().session_manager.run():
        yield
