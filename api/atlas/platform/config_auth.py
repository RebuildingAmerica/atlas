"""Auth-related configuration helpers."""

from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import urlsplit, urlunsplit

if TYPE_CHECKING:
    from atlas.platform.config import Settings


def protected_resource_metadata_url(resource_url: str) -> str:
    """Return the RFC 9728 metadata URL for a protected resource."""
    parsed = urlsplit(resource_url.rstrip("/"))
    metadata_path = "/.well-known/oauth-protected-resource"
    resource_path = parsed.path.rstrip("/")
    if resource_path:
        metadata_path = f"{metadata_path}{resource_path}"
    return urlunsplit((parsed.scheme, parsed.netloc, metadata_path, "", ""))


def validate_runtime_auth_config(settings: Settings) -> None:
    """Fail fast when an auth-enabled deployment is missing required config."""
    if settings.deploy_mode == "local":
        return
    if settings.environment == "dev" and settings.deploy_mode == "":
        return
    if not settings.auth_jwt_audience:
        msg = (
            "ATLAS_AUTH_JWT_AUDIENCES is required for staging, production, and non-local deploy modes. "
            "Set it to the canonical resource URL(s) the API accepts in JWT 'aud' "
            "claims, with the MCP resource first, e.g. https://atlas.example.com/mcp."
        )
        raise RuntimeError(msg)
    if not settings.auth_internal_secret:
        msg = "ATLAS_AUTH_INTERNAL_SECRET is required when ATLAS_DEPLOY_MODE is not 'local'."
        raise RuntimeError(msg)
    if not settings.auth_api_key_introspection_url:
        msg = (
            "ATLAS_AUTH_API_KEY_INTROSPECTION_URL is required when "
            "ATLAS_DEPLOY_MODE is not 'local'."
        )
        raise RuntimeError(msg)
    if not settings.auth_membership_verification_url:
        msg = "ATLAS_AUTH_MEMBERSHIP_URL is required when ATLAS_DEPLOY_MODE is not 'local'."
        raise RuntimeError(msg)
    if not settings.auth_jwt_issuer:
        msg = "ATLAS_PUBLIC_URL is required when ATLAS_DEPLOY_MODE is not 'local'."
        raise RuntimeError(msg)

    public_origin = settings.auth_jwt_issuer.removesuffix("/api/auth")
    public_url = urlsplit(public_origin)
    if public_url.scheme != "https" and public_url.hostname not in {
        "localhost",
        "127.0.0.1",
        "::1",
    }:
        msg = "ATLAS_PUBLIC_URL must use https when ATLAS_DEPLOY_MODE is not 'local'."
        raise RuntimeError(msg)

    expected_mcp_audience = urlunsplit((public_url.scheme, public_url.netloc, "/mcp", "", ""))
    if settings.auth_jwt_audience[0] != expected_mcp_audience:
        msg = f"ATLAS_AUTH_JWT_AUDIENCES must put the canonical MCP resource first: {expected_mcp_audience}"
        raise RuntimeError(msg)
