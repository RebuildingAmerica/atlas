"""Membership verification client with in-memory TTL cache."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx
from fastapi import status

if TYPE_CHECKING:
    from atlas.platform.config import Settings

logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 60

_CacheKey = tuple[str, str]


@dataclass(slots=True)
class MembershipResult:
    """Verified organization membership details."""

    role: str
    slug: str
    name: str
    workspace_type: str


@dataclass(slots=True)
class _CacheEntry:
    result: MembershipResult
    expires_at: float


_cache: dict[_CacheKey, _CacheEntry] = {}


def _get_cached(user_id: str, org_id: str) -> MembershipResult | None:
    key: _CacheKey = (user_id, org_id)
    entry = _cache.get(key)
    if entry is None:
        return None
    if time.monotonic() > entry.expires_at:
        del _cache[key]
        return None
    return entry.result


def _set_cached(user_id: str, org_id: str, result: MembershipResult) -> None:
    key: _CacheKey = (user_id, org_id)
    _cache[key] = _CacheEntry(
        result=result,
        expires_at=time.monotonic() + _CACHE_TTL_SECONDS,
    )


async def verify_org_membership(
    user_id: str, org_id: str, settings: Settings
) -> MembershipResult | None:
    """Verify a user's membership in an organization.

    Returns the membership details on success, None if the user is not a member.
    Raises on unexpected errors.
    """
    cached = _get_cached(user_id, org_id)
    if cached is not None:
        return cached

    url = (
        f"{settings.auth_membership_verification_url.rstrip('/')}"
        f"/api/auth/internal/memberships/{org_id}/members/{user_id}"
    )

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                url,
                headers={
                    "X-Atlas-Internal-Secret": settings.auth_internal_secret,
                },
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
    result = MembershipResult(
        role=str(payload["role"]),
        slug=str(payload["slug"]),
        name=str(payload["name"]),
        workspace_type=str(payload["workspaceType"]),
    )

    _set_cached(user_id, org_id, result)
    return result
