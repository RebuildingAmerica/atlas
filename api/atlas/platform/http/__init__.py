"""HTTP platform exports."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import APIRouter

__all__ = ["create_router"]


def create_router(*, managed: bool) -> APIRouter:
    """Create the main API router without importing it during package initialization.

    Parameters
    ----------
    managed : bool
        Whether to mount the platform routes.

    Returns
    -------
    APIRouter
        The main router.
    """
    from atlas.platform.http.router import create_router as _create_router

    return _create_router(managed=managed)
