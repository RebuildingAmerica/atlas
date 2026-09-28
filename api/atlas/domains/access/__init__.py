"""Authentication helpers for protected API endpoints."""

from .api_keys import verify_api_key
from .dependencies import (
    require_actor,
    require_actor_permission,
    require_org_actor,
    require_org_actor_permission,
)
from .principals import ApiKeyPrincipal, AuthenticatedActor
from .staff import ensure_atlas_staff, is_atlas_staff, require_atlas_staff

__all__ = [
    "ApiKeyPrincipal",
    "AuthenticatedActor",
    "ensure_atlas_staff",
    "is_atlas_staff",
    "require_actor",
    "require_actor_permission",
    "require_atlas_staff",
    "require_org_actor",
    "require_org_actor_permission",
    "verify_api_key",
]
