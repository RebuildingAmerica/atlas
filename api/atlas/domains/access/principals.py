"""Auth principal models."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .capabilities import ResolvedCapabilities


@dataclass(slots=True)
class ApiKeyPrincipal:
    """Represents a verified API key principal."""

    key_id: str
    name: str
    permissions: dict[str, list[str]] | None
    user_id: str
    user_email: str
    org_id: str | None = None


@dataclass(slots=True)
class AuthenticatedActor:
    """Represents the authenticated caller for protected requests."""

    user_id: str
    email: str
    auth_type: str
    api_key_id: str | None = None
    is_local: bool = False
    permissions: dict[str, list[str]] | None = None
    org_id: str | None = None
    org_role: str | None = None
    org_slug: str | None = None
    workspace_type: str | None = None
    active_products: list[str] | None = None
    resolved_capabilities: ResolvedCapabilities | None = None
