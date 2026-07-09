"""HTTP platform exports."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import APIRouter

__all__ = ["create_router"]


def create_router() -> APIRouter:
    """Create the main API router without importing it during package initialization."""
    from atlas.platform.http.router import create_router as _create_router

    return _create_router()
