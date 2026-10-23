"""The platform routes: Atlas-owned administration that exists only on a managed deployment.

They are mounted only when ``ATLAS_MANAGED`` is true, never appear in the
public OpenAPI document or the published API reference, and are described in
their own document for the platform admin app.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from fastapi.openapi.utils import get_openapi

from atlas.domains.access.api.account_lookup_admin import router as account_lookup_router
from atlas.domains.access.api.cloud_cost_admin import router as cloud_cost_admin_router
from atlas.domains.access.api.platform_switches_admin import router as switches_admin_router
from atlas.domains.access.api.verification_admin import router as verification_admin_router
from atlas.domains.access.api.waitlist_admin import router as waitlist_router
from atlas.platform.openapi_metadata import OPENAPI_VERSION

__all__ = [
    "PLATFORM_OPENAPI_TITLE",
    "build_platform_openapi",
    "create_platform_router",
    "main",
]

PLATFORM_OPENAPI_TITLE = "Atlas platform API"
PLATFORM_OPENAPI_FILENAME = "atlas-platform.openapi.json"

# The checkout root, where ``main`` writes the exported document. A constant so a
# test can aim the export at a temporary directory instead of rewriting this
# module's ``__file__``, which makes coverage drop its lines under pytest-xdist.
PROJECT_ROOT = Path(__file__).resolve().parents[4]


def create_platform_router() -> APIRouter:
    """Create the router holding every platform route.

    Returns
    -------
    APIRouter
        The platform routes, each guarded by a ``platform.*`` action.
    """
    router = APIRouter()
    router.include_router(verification_admin_router)
    router.include_router(cloud_cost_admin_router)
    router.include_router(switches_admin_router)
    router.include_router(account_lookup_router)
    router.include_router(waitlist_router)
    return router


def build_platform_openapi(version: str) -> dict[str, Any]:
    """Describe the platform routes in their own OpenAPI document.

    Parameters
    ----------
    version : str
        The API version to stamp on the document.

    Returns
    -------
    dict[str, Any]
        An OpenAPI document covering only the platform routes.
    """
    return get_openapi(
        title=PLATFORM_OPENAPI_TITLE,
        version=version,
        description=(
            "Routes the Atlas platform admin calls on a managed deployment. Each "
            "request carries the admin app's Ed25519 token and the operator's "
            "Cloudflare Access assertion."
        ),
        routes=create_platform_router().routes,
    )


def main() -> None:
    """Write the platform OpenAPI document next to the public one, in ``openapi/``."""
    output_path = PROJECT_ROOT / "openapi" / PLATFORM_OPENAPI_FILENAME
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(build_platform_openapi(OPENAPI_VERSION), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(output_path)


if __name__ == "__main__":  # pragma: no cover
    main()
