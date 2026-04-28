"""RFC 6750 / MCP authorization Bearer challenge construction.

Centralizes how Atlas builds the ``WWW-Authenticate`` header so the format
stays consistent across the REST API dependency chain and the MCP middleware.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterable

    from atlas.platform.config import Settings


def _format_param(name: str, value: str) -> str:
    """Quote a single Bearer challenge auth-param.

    RFC 6750 §3 requires the values of ``error``, ``error_description``,
    ``error_uri``, ``realm``, and ``scope`` to be quoted strings.  Quote every
    parameter for simplicity; downstream parsers tolerate quoted values for
    every defined parameter name.
    """
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'{name}="{escaped}"'


def build_bearer_challenge(
    settings: Settings,
    *,
    scope: Iterable[str] | None = None,
    error: str | None = None,
    error_description: str | None = None,
) -> str:
    """Build a ``WWW-Authenticate: Bearer …`` value for an auth challenge.

    Always includes ``resource_metadata`` (per MCP authorization spec
    §"WWW-Authenticate Header") and the configured default ``scope`` (per
    spec §"Scope Selection Strategy") so MCP clients can request the
    smallest token that satisfies the request without an extra round-trip
    to fetch the protected-resource metadata.

    Parameters
    ----------
    settings:
        Resolved Atlas settings; provides the resource-metadata URL and the
        default scope set.
    scope:
        Optional override for the scope hint published in the challenge.
        Used by 403 ``insufficient_scope`` responses to advertise the scope
        set required to satisfy the original request.  Falls back to the
        configured default when ``None``.
    error:
        Optional ``error`` parameter (e.g., ``insufficient_scope``).  Omitted
        from a plain 401 challenge per RFC 6750 §3.
    error_description:
        Optional human-readable description.  Only included when ``error`` is
        set, matching RFC 6750 §3 grammar.
    """
    parts: list[str] = []

    metadata_url = settings.auth_resource_metadata_url
    if metadata_url:
        parts.append(_format_param("resource_metadata", metadata_url))

    scope_values = list(scope) if scope is not None else list(settings.auth_jwt_default_scope)
    if scope_values:
        parts.append(_format_param("scope", " ".join(scope_values)))

    if error:
        parts.append(_format_param("error", error))
        if error_description:
            parts.append(_format_param("error_description", error_description))

    return "Bearer " + ", ".join(parts) if parts else "Bearer"
