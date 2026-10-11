"""MCP exports without loading the server for ordinary catalog reads."""

from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from atlas.platform.mcp.data import AtlasDataService
    from atlas.platform.mcp.resources import (
        ATLAS_RESOURCE_TEMPLATE_URIS,
        DISCOVERY_RUN_BRIEF_MIME_TYPE,
        install_data_resources,
    )
    from atlas.platform.mcp.server import (
        build_mcp,
        get_mcp,
        get_mcp_asgi_app,
        mcp_session_lifespan,
    )
    from atlas.platform.mcp.server_transport import (
        build_transport_security_settings,
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

_EXPORT_MODULES = {
    "AtlasDataService": "data",
    "ATLAS_RESOURCE_TEMPLATE_URIS": "resources",
    "DISCOVERY_RUN_BRIEF_MIME_TYPE": "resources",
    "install_data_resources": "resources",
    "build_mcp": "server",
    "get_mcp": "server",
    "get_mcp_asgi_app": "server",
    "mcp_session_lifespan": "server",
    "build_transport_security_settings": "server_transport",
    "split_cors_origins": "server_transport",
}


def __getattr__(name: str) -> Any:
    """Keep public values identical while loading only their owning module."""
    module = _EXPORT_MODULES.get(name)
    if module is None:
        raise AttributeError(name)
    return getattr(import_module(f"{__name__}.{module}"), name)


def __dir__() -> list[str]:
    """Retain discoverable package exports before their modules are loaded."""
    return sorted(set(globals()) | set(__all__))
