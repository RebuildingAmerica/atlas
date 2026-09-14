"""Read the IRS returns of the organizations a run found.

The register gives a run organizations. Their most recent returns name the
people who run them, so a run that found organizations can find people without
a search vendor. What each return says about those people is turned into
mentions and resolved in ``atlas.domains.discovery.resolution``.
"""

from __future__ import annotations

import logging
from itertools import batched
from typing import TYPE_CHECKING

from atlas_discovery_engine import FilingOfficerProvider, IrsFilingOfficerProvider

if TYPE_CHECKING:
    from collections.abc import Sequence

    from atlas_discovery_engine import OrganizationFiling, RegistryOrganization

logger = logging.getLogger(__name__)

__all__ = ["build_filing_provider", "collect_filing_officers"]

# Each lookup lists the IRS archives and reads their directories once, so
# fewer, larger batches cost less than one lookup per organization. The batch
# still lets a run stop once its people budget is spent.
_ORGANIZATIONS_PER_LOOKUP = 100


def build_filing_provider(limit: int) -> FilingOfficerProvider | None:
    """Build the filing-officer adapter for a run, or None to skip it.

    Parameters
    ----------
    limit : int
        People the run may take from returns. Zero skips the lookup, which
        keeps a run configured for nothing off the network.

    Returns
    -------
    FilingOfficerProvider | None
        The IRS-backed adapter when there is budget, else None.
    """
    if limit <= 0:
        return None
    return IrsFilingOfficerProvider()


async def collect_filing_officers(
    provider: FilingOfficerProvider,
    organizations: Sequence[RegistryOrganization],
    *,
    limit: int,
) -> list[tuple[RegistryOrganization, OrganizationFiling]]:
    """Read officers for a run's organizations until the people budget is met.

    Parameters
    ----------
    provider : FilingOfficerProvider
        The adapter that reads returns.
    organizations : Sequence[RegistryOrganization]
        Organizations the register returned, in the order the run found them.
    limit : int
        People the run may take. Lookups stop once filings name this many.

    Returns
    -------
    list[tuple[RegistryOrganization, OrganizationFiling]]
        Each organization paired with the return its officers came from.
    """
    by_ein = {organization.registry_id: organization for organization in organizations}
    pairs: list[tuple[RegistryOrganization, OrganizationFiling]] = []
    people = 0
    for batch in batched(organizations, _ORGANIZATIONS_PER_LOOKUP):
        if people >= limit:
            break
        for filing in await provider.filings_for([org.registry_id for org in batch]):
            pairs.append((by_ein[filing.ein], filing))
            people += len(filing.officers)

    logger.info(
        "Filing officers collected",
        extra={"organizations": len(organizations), "filings": len(pairs), "people": people},
    )
    return pairs
