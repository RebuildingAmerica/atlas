"""The keyless half of a discovery run: the nonprofit register and its returns.

Search and page fetching need a paid vendor and can come back empty. The
register names organizations and their IRS returns name the people who run
them, so this stage yields mentions whatever the search vendor does.

It yields typed mentions rather than entry-shaped dictionaries. A register row
carries an EIN and a return row carries a name field, role boxes and a tax
period, and resolution needs every one of them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from atlas.domains.discovery.pipeline.registry_entries import (
    build_registry_provider,
    collect_registry_organizations,
)
from atlas.domains.discovery.pipeline.registry_people import (
    build_filing_provider,
    collect_filing_officers,
)
from atlas.domains.discovery.resolution.register_mentions import (
    organization_mention,
    person_mentions,
)

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import date

    from atlas.domains.discovery.resolution.mentions import OrganizationMention, PersonMention
    from atlas.platform.config import Settings

__all__ = ["RegistryDiscovery", "discover_from_registry"]


@dataclass(frozen=True)
class RegistryDiscovery:
    """Mentions the register and its returns produced."""

    organizations: list[OrganizationMention] = field(default_factory=list)
    """One mention per named register row, unique by EIN."""

    people: list[PersonMention] = field(default_factory=list)
    """People the organizations' returns name, at most the run's people budget."""

    @property
    def mention_count(self) -> int:
        """Count every mention, for the run's statistics."""
        return len(self.organizations) + len(self.people)


async def discover_from_registry(
    *,
    state: str,
    issue_areas: Sequence[str],
    settings: Settings,
    today: date,
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
    today : date
        The date the run reads its sources, which judges whether a role is current.

    Returns
    -------
    RegistryDiscovery
        Organization and person mentions ready for resolution.
    """
    registry = build_registry_provider(settings.discovery_registry_max_organizations)
    if registry is None:
        return RegistryDiscovery()

    rows = await collect_registry_organizations(
        registry,
        state=state,
        issue_areas=issue_areas,
        limit=settings.discovery_registry_max_organizations,
    )
    organizations = {
        mention.ein: mention for mention in map(organization_mention, rows) if mention is not None
    }

    people: list[PersonMention] = []
    limit = settings.discovery_registry_max_people
    filings_provider = build_filing_provider(limit)
    if filings_provider is not None:
        named = [row for row in rows if row.registry_id in organizations]
        for row, filing in await collect_filing_officers(filings_provider, named, limit=limit):
            people.extend(person_mentions(organizations[row.registry_id], filing, today=today))

    return RegistryDiscovery(organizations=list(organizations.values()), people=people[:limit])
