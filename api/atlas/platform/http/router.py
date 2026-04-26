"""Main API router combining all endpoints."""

from fastapi import APIRouter

from atlas.domains.access.api.health import router as auth_health_router
from atlas.domains.access.api.verification import router as verification_router
from atlas.domains.access.api.verification_admin import router as verification_admin_router
from atlas.domains.catalog.api.entries import router as entries_router
from atlas.domains.catalog.api.org_annotations import router as org_annotations_router
from atlas.domains.catalog.api.org_resources import router as org_resources_router
from atlas.domains.catalog.api.public import router as public_router
from atlas.domains.catalog.api.taxonomy import router as taxonomy_router
from atlas.domains.discovery.api import router as discovery_router
from atlas.domains.discovery.api_org import router as org_discovery_router
from atlas.domains.moderation.api import router as flags_router

__all__ = ["create_router"]


def create_router() -> APIRouter:
    """
    Create the main API router with all sub-routers.

    Returns
    -------
    APIRouter
        The main router with all endpoints.
    """
    # Deferred import to avoid circular dependency through atlas.platform.http.__init__
    from atlas.domains.discovery.api_schedule import router as schedule_router

    router = APIRouter()

    # Include sub-routers
    router.include_router(auth_health_router, prefix="/api")
    router.include_router(verification_router, prefix="")
    router.include_router(verification_admin_router, prefix="")
    router.include_router(entries_router, prefix="/api/entities")
    router.include_router(discovery_router, prefix="/api/discovery-runs")
    router.include_router(schedule_router, prefix="/api/discovery-schedules")
    router.include_router(flags_router, prefix="/api")
    router.include_router(taxonomy_router, prefix="/api")
    router.include_router(public_router, prefix="/api")

    # Org-scoped private resource routers
    router.include_router(org_resources_router, prefix="/api/orgs/{org_id}/entries")
    router.include_router(org_annotations_router, prefix="/api/orgs/{org_id}/annotations")
    router.include_router(org_discovery_router, prefix="/api/orgs/{org_id}/discovery-runs")

    return router
