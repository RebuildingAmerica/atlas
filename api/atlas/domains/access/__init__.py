"""Authentication helpers for protected API endpoints."""

from .api_keys import verify_api_key
from .dependencies import require_actor, require_actor_permission
from .principals import ApiKeyPrincipal, AuthenticatedActor

__all__ = [
    "ApiKeyPrincipal",
    "AuthenticatedActor",
    "require_actor",
    "require_actor_permission",
    "verify_api_key",
]
