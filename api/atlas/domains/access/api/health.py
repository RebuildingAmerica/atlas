"""Auth integration health check endpoint."""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends

from atlas.platform.config import Settings, get_settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["access"])


@router.get("/auth/health")
async def auth_health(
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    """Check reachability of the external auth integration endpoints.

    Returns a per-service status map so operators can diagnose
    misconfigurations during deployment.  This endpoint does not require
    authentication because it is used for infrastructure monitoring.
    """
    checks: dict[str, str] = {}

    if settings.deploy_mode == "local":
        return {"status": "ok", "mode": "local", "checks": {}}

    async with httpx.AsyncClient(timeout=5.0) as client:
        checks["jwks"] = await _check_url(client, settings.auth_jwt_jwks_url, "JWKS")

        if settings.auth_membership_verification_url:
            membership_url = f"{settings.auth_membership_verification_url.rstrip('/')}/health"
            checks["membership"] = await _check_url(client, membership_url, "membership")
        else:
            checks["membership"] = "not_configured"

        if settings.auth_api_key_introspection_url:
            checks["api_key_introspection"] = "configured"
        else:
            checks["api_key_introspection"] = "not_configured"

    all_reachable = all(v in {"reachable", "configured"} for v in checks.values())
    status = "ok" if all_reachable else "degraded"

    return {"status": status, "checks": checks}


async def _check_url(client: httpx.AsyncClient, url: str, label: str) -> str:
    """Attempt a HEAD request and return a status string.

    Parameters
    ----------
    client
        The httpx client to use.
    url
        The URL to check.
    label
        A human-readable label for log messages.
    """
    if not url:
        return "not_configured"
    try:
        response = await client.head(url)
    except httpx.RequestError:
        logger.warning(
            "Auth health check could not reach endpoint",
            extra={"label": label, "url": url},
            exc_info=True,
        )
        return "unreachable"

    if response.is_server_error:
        logger.warning(
            "Auth health check returned server error",
            extra={"label": label, "url": url, "status": response.status_code},
        )
        return "server_error"

    return "reachable"
