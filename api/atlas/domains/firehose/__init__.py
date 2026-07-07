"""Firehose API domain."""

from fastapi import APIRouter

from .api import router as workspace_router
from .observation_signals_api import router as observation_signals_router
from .public import router as public_router
from .source_targets_api import router as source_targets_router

router = APIRouter()
router.include_router(observation_signals_router)
router.include_router(workspace_router)
router.include_router(public_router)
router.include_router(source_targets_router)

__all__ = ["router"]
