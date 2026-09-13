"""Turn nonprofit-register rows into discovery candidates.

Web search finds an organization by reading a page about it, which costs a
search query, a page fetch and a model call. The register already holds the
organization as structured fields, so these candidates skip extraction
entirely and join the run at the deduplication step.

They are candidates, not conclusions. An EIN proves an organization filed a
return, not that anyone is doing anything worth finding, so registry rows face
the same scoring and trust gates that web results do.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from atlas_discovery_engine import (
    ProPublicaRegistryProvider,
    RegistryOrganization,
    RegistryProvider,
    registry_terms_for_issue,
)
from atlas_shared import SourceType

from atlas.taxonomy.search_terms import ISSUE_SEARCH_TERMS

if TYPE_CHECKING:
    from collections.abc import Sequence

logger = logging.getLogger(__name__)

__all__ = [
    "build_registry_provider",
    "collect_registry_organizations",
    "is_registry_corroborated",
    "registry_candidate",
    "registry_organizations_to_entries",
]


def is_registry_corroborated(source_urls: Sequence[str]) -> bool:
    """Report whether a record cites the nonprofit register itself.

    The trust gate auto-publishes an organization only when an authoritative
    registry confirms it, meaning an EIN or 990 filing. A register source URL
    is that filing's public page, so citing one is the corroboration the gate
    asks for. A city council page is also a government record and is not.

    Parameters
    ----------
    source_urls : Sequence[str]
        Every source the record cites.

    Returns
    -------
    bool
        True when at least one source is a register filing page.
    """
    prefix = ProPublicaRegistryProvider.ORGANIZATION_URL
    return any(url.startswith(prefix) for url in source_urls)


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


def registry_organizations_to_entries(
    organizations: Sequence[RegistryOrganization],
    *,
    issue_areas: Sequence[str],
    today_iso: str,
) -> list[dict[str, Any]]:
    """Shape register rows like the entries extraction produces.

    Parameters
    ----------
    organizations : Sequence[RegistryOrganization]
        Rows the register returned.
    issue_areas : Sequence[str]
        Issue areas to attribute the candidates to, from the run's schedule.
    today_iso : str
        Date to record as when the register was read.

    Returns
    -------
    list[dict[str, Any]]
        Candidate dictionaries ready for deduplication.
    """
    return [
        registry_candidate(
            name=organization.name,
            entry_type="organization",
            context=_context_for(organization),
            city=organization.city,
            state=organization.state,
            issue_areas=issue_areas,
            website=organization.website,
            affiliated_org=None,
            source_url=organization.source_url,
            today_iso=today_iso,
        )
        for organization in organizations
        if organization.name
    ]


def registry_candidate(  # noqa: PLR0913
    *,
    name: str,
    entry_type: str,
    context: str,
    city: str | None,
    state: str | None,
    issue_areas: Sequence[str],
    website: str | None,
    affiliated_org: str | None,
    source_url: str,
    today_iso: str,
) -> dict[str, Any]:
    """Shape one register-derived record like the entries extraction produces.

    Parameters
    ----------
    name : str
        The organization's or person's name as the filing gives it.
    entry_type : str
        ``organization`` or ``person``.
    context : str
        What the filing asserts, used as both description and citation.
    city, state : str | None
        Where the filer is based.
    issue_areas : Sequence[str]
        Issue areas from the run's schedule.
    website : str | None
        Website the register publishes, when it publishes one.
    affiliated_org : str | None
        For a person, the organization whose return names them.
    source_url : str
        The register page or return the record cites.
    today_iso : str
        Date the register was read.

    Returns
    -------
    dict[str, Any]
        A candidate ready for deduplication.
    """
    return {
        "name": name,
        # Extraction emits "type" while persistence reads "entry_type", and
        # deduplication passes both through untouched. Carrying both keeps a
        # registry candidate indistinguishable from an extracted one.
        "type": entry_type,
        "entry_type": entry_type,
        "description": context,
        "city": city,
        "state": state,
        "geo_specificity": "local",
        "issue_areas": list(issue_areas),
        "region": None,
        "website": website,
        "email": None,
        "social_media": {},
        "affiliated_org": affiliated_org,
        "extraction_context": context,
        "mentioned_entities": [],
        "discovery_leads": [],
        "source_urls": [source_url],
        "source_dates": [today_iso],
        "source_contexts": {source_url: context},
        "source_types": [str(SourceType.GOVERNMENT_RECORD)],
        "last_seen": today_iso,
    }


def _context_for(organization: RegistryOrganization) -> str:
    """Describe what the register actually asserts about an organization."""
    where = ", ".join(part for part in (organization.city, organization.state) if part)
    sentence = f"Registered nonprofit filing IRS Form 990 under EIN {organization.registry_id}"
    if where:
        sentence += f", based in {where}"
    if organization.category_code:
        sentence += f", classified {organization.category_code}"
    return f"{sentence}."
