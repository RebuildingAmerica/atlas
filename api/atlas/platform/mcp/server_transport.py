"""Atlas MCP transport-security helpers."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

if TYPE_CHECKING:
    from collections.abc import Iterable

    from mcp.server.transport_security import TransportSecuritySettings

    from atlas.platform.config import Settings

LOCAL_ALLOWED_HOSTS = ["127.0.0.1:*", "localhost:*", "[::1]:*"]
LOCAL_ALLOWED_ORIGINS = ["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"]

_CORS_WILDCARD_PORT_SUFFIX = ":*"


def _origin_and_host(value: str) -> tuple[str | None, str | None]:
    parsed = urlsplit(value.rstrip("/"))
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None, None
    return f"{parsed.scheme}://{parsed.netloc}", parsed.netloc


def build_transport_allowlists(settings: Settings) -> tuple[list[str], list[str]]:
    """Derive the same host/origin policy for HTTP CORS and MCP transport."""
    allowed_hosts = set(LOCAL_ALLOWED_HOSTS)
    allowed_origins = set(LOCAL_ALLOWED_ORIGINS)

    configured_urls = [
        settings.auth_jwt_issuer.removesuffix("/api/auth"),
        *settings.auth_jwt_audience,
        *settings.cors_origins,
    ]
    for configured_url in configured_urls:
        if configured_url == "*":
            continue
        origin, host = _origin_and_host(configured_url)
        if origin:
            allowed_origins.add(origin)
        if host:
            allowed_hosts.add(host)

    return sorted(allowed_hosts), sorted(allowed_origins)


def build_transport_security_settings(settings: Settings) -> TransportSecuritySettings:
    """Build MCP host/origin allowlists only when a transport needs the SDK."""
    from mcp.server.transport_security import TransportSecuritySettings

    allowed_hosts, allowed_origins = build_transport_allowlists(settings)
    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=allowed_hosts,
        allowed_origins=allowed_origins,
    )


def split_cors_origins(allowed_origins: Iterable[str]) -> tuple[list[str], str | None]:
    """Split an MCP transport-security origin allowlist for `CORSMiddleware`."""
    exact_origins: list[str] = []
    wildcard_patterns: list[str] = []
    for origin in allowed_origins:
        if origin.endswith(_CORS_WILDCARD_PORT_SUFFIX):
            prefix = re.escape(origin.removesuffix(_CORS_WILDCARD_PORT_SUFFIX))
            wildcard_patterns.append(rf"{prefix}:\d+")
        else:
            exact_origins.append(origin)

    if not wildcard_patterns:
        return exact_origins, None
    return exact_origins, "|".join(wildcard_patterns)
