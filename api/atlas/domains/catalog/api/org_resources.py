"""Org-scoped private entry endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from .org_resources_directory_routes import *  # noqa: F403
from .org_resources_directory_routes import router as directory_router
from .org_resources_entry_routes import *  # noqa: F403
from .org_resources_entry_routes import router as entry_router
from .org_resources_models import *  # noqa: F403
from .org_resources_support import *  # noqa: F403

router = APIRouter()
router.routes.extend(directory_router.routes)
router.routes.extend(entry_router.routes)

__all__ = ["router"]
