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


def _refuse_identity_harness_outside_staging(settings: Settings) -> None:
    """Refuse a seam that accepts identities without verifying them.

    Runs ahead of every other check, including the single-user early return,
    because a seam that bypasses identity verification must not survive by
    taking a permissive branch.

    Parameters
    ----------
    settings
        Loaded application settings.

    Raises
    ------
    RuntimeError
        If a non-staging deployment enables the ATProto proof-lane harness.
    """
    if settings.atproto_oauth_e2e_harness and settings.environment != "staging":
        msg = (
            "ATLAS_ATPROTO_OAUTH_E2E_HARNESS is only for the staging proof lane. "
            "It accepts synthetic did:web identities without verification, so a "
            "verified badge would stop meaning anything."
        )
        raise RuntimeError(msg)


def validate_runtime_auth_config(settings: Settings) -> None:
    """Fail fast when an instance with accounts is missing required config.

    Requirements follow from whether the instance has accounts, and nothing
    else. There is deliberately no environment-based exemption: the API used to
    skip this entirely when ``ENVIRONMENT`` was dev while the app enforced it
    regardless, so the default contributor stack was hosted to one half and dev
    to the other. Local development supplies real values and always did.

    Parameters
    ----------
    settings
        Loaded application settings.

    Raises
    ------
    RuntimeError
        If an instance with accounts is missing required configuration.
    """
    _refuse_identity_harness_outside_staging(settings)
    if not settings.multi_user:
        return
    if not settings.auth_jwt_audience:
        msg = (
            "ATLAS_AUTH_JWT_AUDIENCES is required when ATLAS_MULTI_USER is true. "
            "Set it to the canonical resource URL(s) the API accepts in JWT 'aud' "
            "claims, with the MCP resource first, e.g. https://atlas.example.com/mcp."
        )
        raise RuntimeError(msg)
    if not settings.auth_internal_secret:
        msg = "ATLAS_AUTH_INTERNAL_SECRET is required when ATLAS_MULTI_USER is true."
        raise RuntimeError(msg)
    if not settings.auth_api_key_introspection_url:
        msg = "ATLAS_AUTH_API_KEY_INTROSPECTION_URL is required when ATLAS_MULTI_USER is true."
        raise RuntimeError(msg)
    if not settings.auth_membership_verification_url:
        msg = "ATLAS_AUTH_MEMBERSHIP_URL is required when ATLAS_MULTI_USER is true."
        raise RuntimeError(msg)
    if not settings.auth_jwt_issuer:
        msg = "ATLAS_PUBLIC_URL is required when ATLAS_MULTI_USER is true."
        raise RuntimeError(msg)

    public_origin = settings.auth_jwt_issuer.removesuffix("/api/auth")
    public_url = urlsplit(public_origin)
    if public_url.scheme != "https" and public_url.hostname not in {
        "localhost",
        "127.0.0.1",
        "::1",
    }:
        msg = "ATLAS_PUBLIC_URL must use https unless it is a loopback address."
        raise RuntimeError(msg)

    expected_mcp_audience = urlunsplit((public_url.scheme, public_url.netloc, "/mcp", "", ""))
    if settings.auth_jwt_audience[0] != expected_mcp_audience:
        msg = f"ATLAS_AUTH_JWT_AUDIENCES must put the canonical MCP resource first: {expected_mcp_audience}"
        raise RuntimeError(msg)
