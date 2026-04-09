"""Main API router combining all endpoints."""

from fastapi import APIRouter

from atlas.api.discovery import router as discovery_router
from atlas.api.entries import router as entries_router
from atlas.api.taxonomy import router as taxonomy_router

__all__ = ["create_router"]


def create_router() -> APIRouter:
    """
    Create the main API router with all sub-routers.

    Returns
    -------
    APIRouter
        The main router with all endpoints.
    """
    router = APIRouter(prefix="/api/v1", tags=["api"])

    # Include sub-routers
    router.include_router(entries_router, prefix="/entries", tags=["entries"])
    router.include_router(discovery_router, prefix="/discovery", tags=["discovery"])
    router.include_router(taxonomy_router, prefix="/taxonomy", tags=["taxonomy"])

    return router
