"""Main API router combining all endpoints."""

from fastapi import APIRouter

from atlas.domains.access.api.cloud_cost_admin import router as cloud_cost_admin_router
from atlas.domains.access.api.health import router as auth_health_router
from atlas.domains.access.api.lists import router as lists_router
from atlas.domains.access.api.mcp_elicitations import router as mcp_elicitations_router
from atlas.domains.access.api.org_usage import router as org_usage_router
from atlas.domains.access.api.org_watch_digest import router as org_watch_digest_router
from atlas.domains.access.api.org_watches import router as org_watches_router
from atlas.domains.access.api.verification import router as verification_router
from atlas.domains.access.api.verification_admin import router as verification_admin_router
from atlas.domains.catalog.api.atproto_identities import router as atproto_identities_router
from atlas.domains.catalog.api.entries import router as entries_router
from atlas.domains.catalog.api.feed import router as feed_router
from atlas.domains.catalog.api.org_annotations import router as org_annotations_router
from atlas.domains.catalog.api.org_resources import router as org_resources_router
from atlas.domains.catalog.api.profiles import router as profiles_router
from atlas.domains.catalog.api.public import router as public_router
from atlas.domains.catalog.api.taxonomy import router as taxonomy_router
from atlas.domains.discovery.api import router as discovery_router
from atlas.domains.discovery.api_org import router as org_discovery_router
from atlas.domains.discovery.api_org_briefs import router as org_briefs_router
from atlas.domains.discovery.api_org_coverage import router as org_coverage_router
from atlas.domains.discovery.api_org_coverage_reports import router as org_coverage_reports_router
from atlas.domains.discovery.api_org_quality import router as org_quality_router
from atlas.domains.firehose import router as firehose_router
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
    router.include_router(cloud_cost_admin_router, prefix="")
    router.include_router(entries_router, prefix="/api/entities")
    router.include_router(atproto_identities_router, prefix="/api/atproto/identities")
    router.include_router(discovery_router, prefix="/api/discovery-runs")
    router.include_router(schedule_router, prefix="/api/discovery-schedules")
    router.include_router(flags_router, prefix="/api")
    router.include_router(taxonomy_router, prefix="/api")
    router.include_router(public_router, prefix="/api")
    router.include_router(mcp_elicitations_router, prefix="/api")
    router.include_router(firehose_router, prefix="/api")

    # Profile verification, manage, follow, and feed surfaces
    router.include_router(profiles_router, prefix="/api/profiles")
    router.include_router(feed_router, prefix="/api/feed")
    router.include_router(lists_router, prefix="/api/lists")

    # Org-scoped private resource routers
    router.include_router(org_resources_router, prefix="/api/orgs/{org_id}/entries")
    router.include_router(org_annotations_router, prefix="/api/orgs/{org_id}/annotations")
    router.include_router(org_discovery_router, prefix="/api/orgs/{org_id}/discovery-runs")
    router.include_router(org_briefs_router, prefix="/api/orgs/{org_id}/briefs")
    router.include_router(org_coverage_router, prefix="/api/orgs/{org_id}/coverage-targets")
    router.include_router(org_coverage_reports_router, prefix="/api/orgs/{org_id}/coverage-reports")
    router.include_router(org_quality_router, prefix="/api/orgs/{org_id}/quality-summary")
    router.include_router(org_watches_router, prefix="/api/orgs/{org_id}/watches")
    router.include_router(org_watch_digest_router, prefix="/api/orgs/{org_id}/watch-digest")
    router.include_router(org_usage_router, prefix="/api/orgs/{org_id}/usage-summary")

    return router
