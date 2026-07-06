"""MCP server package for Atlas."""

from atlas.platform.mcp.data import AtlasDataService
from atlas.platform.mcp.resources import (
    ATLAS_RESOURCE_TEMPLATE_URIS,
    DISCOVERY_RUN_BRIEF_MIME_TYPE,
    install_data_resources,
)
from atlas.platform.mcp.server import (
    build_mcp,
    build_transport_security_settings,
    get_mcp,
    get_mcp_asgi_app,
    mcp_session_lifespan,
    split_cors_origins,
)

__all__ = [
    "ATLAS_RESOURCE_TEMPLATE_URIS",
    "DISCOVERY_RUN_BRIEF_MIME_TYPE",
    "AtlasDataService",
    "build_mcp",
    "build_transport_security_settings",
    "get_mcp",
    "get_mcp_asgi_app",
    "install_data_resources",
    "mcp_session_lifespan",
    "split_cors_origins",
]
