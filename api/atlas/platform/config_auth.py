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


def _require_parseable_machine_issuers(settings: Settings) -> None:
    """Refuse to start with a trusted machine list that does not parse.

    Parameters
    ----------
    settings
        Loaded application settings.

    Raises
    ------
    RuntimeError
        If ``ATLAS_MACHINE_TRUSTED_ISSUERS`` is set but invalid.
    """
    # Imported here: the access domain imports this module's settings.
    from atlas.domains.access.machine import parse_machine_issuers

    try:
        parse_machine_issuers(settings.machine_trusted_issuers)
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc


def _require_valid_access_config(settings: Settings) -> None:
    """Refuse to start with Cloudflare Access settings that are half-set or malformed.

    Parameters
    ----------
    settings
        Loaded application settings.

    Raises
    ------
    RuntimeError
        If ``ATLAS_ACCESS_TEAM_DOMAIN`` or ``ATLAS_ACCESS_AUD`` is set but invalid.
    """
    # Imported here: the access domain imports this module's settings.
    from atlas.domains.access.cloudflare_access import parse_access_config

    try:
        parse_access_config(settings.access_team_domain, settings.access_aud)
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc


RETIRED_OPERATOR_ALLOWLIST_DETAIL = (
    "ATLAS_OPERATOR_ALLOWED_EMAILS is retired. Put this instance's editors in "
    "ATLAS_INSTANCE_OPERATOR_EMAILS (and, on a managed deployment, platform "
    "operators in ATLAS_PLATFORM_OPERATOR_EMAILS), then remove it."
)


def _refuse_retired_operator_allowlist(settings: Settings) -> None:
    """Refuse to start while the retired single allowlist is still set.

    Starting anyway would silently leave editorial work with no operator, so
    the deployment fails and says which settings replace it.

    Parameters
    ----------
    settings
        Loaded application settings.

    Raises
    ------
    RuntimeError
        If ``ATLAS_OPERATOR_ALLOWED_EMAILS`` has a value.
    """
    if settings.retired_operator_allowed_emails.strip():
        raise RuntimeError(RETIRED_OPERATOR_ALLOWLIST_DETAIL)


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
    _require_parseable_machine_issuers(settings)
    _require_valid_access_config(settings)
    _refuse_retired_operator_allowlist(settings)
    if not settings.multi_user:
        return
    if not settings.auth_jwt_audience:
        msg = (
            "ATLAS_AUTH_JWT_AUDIENCES is required when ATLAS_MULTI_USER is true. "
            "Set it to the canonical resource URL(s) the API accepts in JWT 'aud' "
            "claims, with the MCP resource first, e.g. https://atlas.example.com/mcp."
        )
        raise RuntimeError(msg)
    if not settings.auth_callback_secret:
        msg = "ATLAS_AUTH_CALLBACK_SECRET is required when ATLAS_MULTI_USER is true."
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
