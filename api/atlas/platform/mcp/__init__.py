"""MCP server package for Atlas."""

from atlas.platform.mcp.data import AtlasDataService
from atlas.platform.mcp.server import (
    build_mcp,
    get_mcp,
    get_mcp_asgi_app,
    mcp_session_lifespan,
)

__all__ = [
    "AtlasDataService",
    "build_mcp",
    "get_mcp",
    "get_mcp_asgi_app",
    "mcp_session_lifespan",
]
