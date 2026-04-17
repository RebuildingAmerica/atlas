"""API key verification helpers."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import httpx
from fastapi import status

from .principals import ApiKeyPrincipal

if TYPE_CHECKING:
    from atlas.platform.config import Settings

logger = logging.getLogger(__name__)


async def verify_api_key(api_key: str, settings: Settings) -> ApiKeyPrincipal | None:
    """Verify an API key through the configured introspection endpoint."""
    if not settings.auth_api_key_introspection_url or not settings.auth_internal_secret:
        return None

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                settings.auth_api_key_introspection_url,
                headers={
                    "X-API-Key": api_key,
                    "X-Atlas-Internal-Secret": settings.auth_internal_secret,
                },
            )
    except Exception:
        logger.exception(
            "API key introspection request failed",
            extra={"introspection_url": settings.auth_api_key_introspection_url},
        )
        raise

    if response.status_code in {status.HTTP_401_UNAUTHORIZED, status.HTTP_404_NOT_FOUND}:
        return None

    if response.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        logger.error(
            "API key introspection returned a server error",
            extra={
                "introspection_url": settings.auth_api_key_introspection_url,
                "response_body": response.text,
                "response_status": response.status_code,
            },
        )

    response.raise_for_status()
    payload = response.json()
    if not payload.get("valid"):
        return None

    return ApiKeyPrincipal(
        key_id=str(payload["keyId"]),
        name=str(payload["name"]),
        permissions=payload.get("permissions"),
        user_id=str(payload["userId"]),
        user_email=str(payload["userEmail"]),
    )
