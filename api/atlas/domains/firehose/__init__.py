"""Firehose API domain."""

from fastapi import APIRouter

from .api import router as workspace_router
from .public import router as public_router

router = APIRouter()
router.include_router(workspace_router)
router.include_router(public_router)

__all__ = ["router"]
