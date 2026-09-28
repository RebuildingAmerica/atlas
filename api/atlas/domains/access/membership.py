"""Membership verification client for current workspace roles and products."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import httpx
from fastapi import status

if TYPE_CHECKING:
    from atlas.platform.config import Settings

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class MembershipResult:
    """Verified organization membership details."""

    role: str
    slug: str
    name: str
    workspace_type: str
    active_products: list[str] = field(default_factory=list)
    workspace_domain: str | None = None
    verified_sso_domains: list[str] = field(default_factory=list)


def _membership_request_headers(settings: Settings) -> dict[str, str]:
    headers = {
        "X-Atlas-Internal-Secret": settings.auth_internal_secret,
    }
    bypass_secret = settings.auth_membership_protection_bypass_secret.strip()
    if bypass_secret:
        headers["x-vercel-protection-bypass"] = bypass_secret
    return headers


async def verify_org_membership(
    user_id: str, org_id: str, settings: Settings
) -> MembershipResult | None:
    """Verify current membership, role, and products for every request.

    A cached product grant delays a paid upgrade; a cached role can retain
    revoked access. Returns None if the user is no longer a member.
    Raises on unexpected errors.
    """
    url = (
        f"{settings.auth_membership_verification_url.rstrip('/')}"
        f"/api/auth/internal/memberships/{org_id}/members/{user_id}"
    )

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                url,
                headers=_membership_request_headers(settings),
            )
    except Exception:
        logger.exception(
            "Membership verification request failed",
            extra={
                "user_id": user_id,
                "org_id": org_id,
                "verification_url": url,
            },
        )
        raise

    if response.status_code == status.HTTP_404_NOT_FOUND:
        return None

    if response.status_code != status.HTTP_200_OK:
        logger.error(
            "Membership verification returned unexpected status",
            extra={
                "user_id": user_id,
                "org_id": org_id,
                "response_status": response.status_code,
                "response_body": response.text,
            },
        )
        response.raise_for_status()

    payload = response.json()
    return MembershipResult(
        role=str(payload["role"]),
        slug=str(payload["slug"]),
        name=str(payload["name"]),
        workspace_type=str(payload["workspaceType"]),
        active_products=[str(p) for p in payload.get("activeProducts", [])],
        workspace_domain=(
            str(payload["workspaceDomain"]) if payload.get("workspaceDomain") is not None else None
        ),
        verified_sso_domains=[str(domain) for domain in payload.get("verifiedSsoDomains", [])],
    )
