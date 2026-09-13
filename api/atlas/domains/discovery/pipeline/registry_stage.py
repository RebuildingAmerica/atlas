"""The keyless half of a discovery run: the nonprofit register and its returns.

Search and page fetching need a paid vendor and can come back empty. The
register names organizations and their IRS returns name the people who run
them, so this stage yields candidates whatever the search vendor does.

It returns source records alongside the candidates. A register page or a
return is never fetched like a web page, so without a record saying what it is,
persistence would store a federal filing as an organization's own website and
a visitor would see it described that way.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from atlas_shared import PageContent, SourceType

from atlas.domains.discovery.pipeline.registry_entries import (
    build_registry_provider,
    collect_registry_organizations,
    registry_organizations_to_entries,
)
from atlas.domains.discovery.pipeline.registry_people import (
    build_filing_provider,
    collect_filing_officers,
    filing_officers_to_entries,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

    from atlas.platform.config import Settings

__all__ = ["RegistryDiscovery", "discover_from_registry"]

_PUBLICATION = "ProPublica Nonprofit Explorer"


@dataclass(frozen=True)
class RegistryDiscovery:
    """Candidates the register produced, and the sources they cite."""

    entries: list[dict[str, Any]] = field(default_factory=list)
    """Organization and person candidates, shaped like extracted entries."""

    sources: list[PageContent] = field(default_factory=list)
    """One record per register page or return the candidates cite."""


async def discover_from_registry(
    *,
    state: str,
    issue_areas: Sequence[str],
    settings: Settings,
    today_iso: str,
) -> RegistryDiscovery:
    """Find organizations in the register, then the people their returns name.

    Parameters
    ----------
    state : str
        Two-letter state code the run covers.
    issue_areas : Sequence[str]
        Issue area slugs the run was scheduled for.
    settings : Settings
        Supplies the organization and people budgets. A zero budget skips
        that half without reaching the network.
    today_iso : str
        Date to record as when the register was read.

    Returns
    -------
    RegistryDiscovery
        Candidates ready for deduplication, and the sources they cite.
    """
    registry = build_registry_provider(settings.discovery_registry_max_organizations)
    if registry is None:
        return RegistryDiscovery()

    organizations = await collect_registry_organizations(
        registry,
        state=state,
        issue_areas=issue_areas,
        limit=settings.discovery_registry_max_organizations,
    )
    entries = registry_organizations_to_entries(
        organizations, issue_areas=issue_areas, today_iso=today_iso
    )
    sources = {
        organization.source_url: PageContent(
            url=organization.source_url,
            title=f"{organization.name}: IRS Form 990 filings",
            publication=_PUBLICATION,
            source_type=SourceType.GOVERNMENT_RECORD,
        )
        for organization in organizations
        if organization.name
    }

    filings_provider = build_filing_provider(settings.discovery_registry_max_people)
    if filings_provider is not None:
        filings = await collect_filing_officers(
            filings_provider, organizations, limit=settings.discovery_registry_max_people
        )
        entries.extend(
            filing_officers_to_entries(
                filings,
                issue_areas=issue_areas,
                today_iso=today_iso,
                limit=settings.discovery_registry_max_people,
            )
        )
        for organization, filing in filings:
            sources[filing.source_url] = PageContent(
                url=filing.source_url,
                title=f"{organization.name}: IRS Form 990 return {filing.object_id}",
                publication=_PUBLICATION,
                source_type=SourceType.GOVERNMENT_RECORD,
            )

    return RegistryDiscovery(entries=entries, sources=list(sources.values()))
