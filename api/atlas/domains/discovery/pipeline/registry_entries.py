"""Query the nonprofit register for a run's organizations.

Web search finds an organization by reading a page about it, which costs a
search query, a page fetch and a model call. The register already holds the
organization as structured fields keyed by EIN, so its rows skip extraction
and go straight to resolution in ``atlas.domains.discovery.resolution``.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from atlas_discovery_engine import (
    ProPublicaRegistryProvider,
    RegistryOrganization,
    RegistryProvider,
    registry_terms_for_issue,
)

from atlas.taxonomy.search_terms import ISSUE_SEARCH_TERMS

if TYPE_CHECKING:
    from collections.abc import Sequence

logger = logging.getLogger(__name__)

__all__ = ["build_registry_provider", "collect_registry_organizations"]


def build_registry_provider(limit: int) -> RegistryProvider | None:
    """Build the register adapter for a run, or None to skip the register.

    Mirrors build_search_provider: a run that was given no budget reaches no
    network, which keeps a test that configures nothing offline by default.

    Parameters
    ----------
    limit : int
        Organizations the run may take from the register. Zero skips it.

    Returns
    -------
    RegistryProvider | None
        A ProPublica-backed adapter when there is budget, else None.
    """
    if limit <= 0:
        return None
    return ProPublicaRegistryProvider()


async def collect_registry_organizations(
    provider: RegistryProvider,
    *,
    state: str,
    issue_areas: Sequence[str],
    limit: int,
) -> list[RegistryOrganization]:
    """Gather register rows for a run's state across its issue areas.

    Parameters
    ----------
    provider : RegistryProvider
        The register to query.
    state : str
        Two-letter state code the run covers.
    issue_areas : Sequence[str]
        Issue area slugs the run was scheduled for.
    limit : int
        Ceiling on organizations returned across every term.

    Returns
    -------
    list[RegistryOrganization]
        Deduplicated organizations, at most ``limit`` of them.
    """
    seen: dict[str, RegistryOrganization] = {}
    for issue_area in issue_areas:
        for term in registry_terms_for_issue(ISSUE_SEARCH_TERMS.get(issue_area, ())):
            if len(seen) >= limit:
                break
            found = await provider.search_organizations(term, state, limit=limit - len(seen))
            for organization in found:
                if organization.registry_id and organization.registry_id not in seen:
                    seen[organization.registry_id] = organization

    logger.info(
        "Registry lookup completed",
        extra={"state": state, "issues": len(issue_areas), "organizations": len(seen)},
    )
    return list(seen.values())[:limit]
