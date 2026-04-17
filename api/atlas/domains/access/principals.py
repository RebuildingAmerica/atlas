"""Auth principal models."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class ApiKeyPrincipal:
    """Represents a verified API key principal."""

    key_id: str
    name: str
    permissions: dict[str, list[str]] | None
    user_id: str
    user_email: str


@dataclass(slots=True)
class AuthenticatedActor:
    """Represents the authenticated caller for protected requests."""

    user_id: str
    email: str
    auth_type: str
    api_key_id: str | None = None
    is_local: bool = False
    permissions: dict[str, list[str]] | None = None
