"""Turn officers named on IRS returns into person candidates.

The register gives a run organizations. Their most recent returns name the
people who run them, so a run that found organizations can find people without
a search vendor. Each person cites the exact return that names them, and that
citation is what the publication gate accepts as authoritative for a person.
"""

from __future__ import annotations

import logging
from itertools import batched
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from atlas_discovery_engine import (
    FilingOfficerProvider,
    IrsFilingOfficerProvider,
    ProPublicaRegistryProvider,
)

from atlas.domains.discovery.pipeline.registry_entries import registry_candidate

if TYPE_CHECKING:
    from collections.abc import Sequence

    from atlas_discovery_engine import FilingOfficer, OrganizationFiling, RegistryOrganization

logger = logging.getLogger(__name__)

__all__ = [
    "build_filing_provider",
    "collect_filing_officers",
    "filing_officers_to_entries",
    "is_filing_corroborated",
]

# Each lookup lists the IRS archives and reads their directories once, so
# fewer, larger batches cost less than one lookup per organization. The batch
# still lets a run stop once its people budget is spent.
_ORGANIZATIONS_PER_LOOKUP = 100
_RETURN_PAGE_SEGMENTS = 3


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


def is_filing_corroborated(source_urls: Sequence[str]) -> bool:
    """Report whether a record cites a specific IRS return.

    An organization's register page proves the organization filed. It names
    nobody, so it corroborates an organization but never a person. A person is
    corroborated only by the page of a return that lists them.

    Parameters
    ----------
    source_urls : Sequence[str]
        Every source the record cites.

    Returns
    -------
    bool
        True when a source is the page for one EIN's one return.
    """
    register = urlsplit(ProPublicaRegistryProvider.ORGANIZATION_URL)
    register_path = PurePosixPath(register.path)
    for url in source_urls:
        parts = urlsplit(url)
        path = PurePosixPath(parts.path)
        if parts.netloc != register.netloc or not path.is_relative_to(register_path):
            continue
        segments = path.relative_to(register_path).parts
        if len(segments) == _RETURN_PAGE_SEGMENTS and _is_return_page(*segments):
            return True
    return False


def _is_return_page(ein: str, object_id: str, page: str) -> bool:
    """Report whether register path segments name one EIN's one return."""
    return ein.isdigit() and object_id.isdigit() and page == "full"


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


def filing_officers_to_entries(
    pairs: Sequence[tuple[RegistryOrganization, OrganizationFiling]],
    *,
    issue_areas: Sequence[str],
    today_iso: str,
    limit: int,
) -> list[dict[str, Any]]:
    """Shape officers like the person entries extraction produces.

    Parameters
    ----------
    pairs : Sequence[tuple[RegistryOrganization, OrganizationFiling]]
        Organizations and the returns their officers came from.
    issue_areas : Sequence[str]
        Issue areas to attribute the people to, from the run's schedule.
    today_iso : str
        Date to record as when the return was read.
    limit : int
        Most people to return.

    Returns
    -------
    list[dict[str, Any]]
        Candidate dictionaries ready for deduplication, at most ``limit``.
    """
    entries: list[dict[str, Any]] = []
    for organization, filing in pairs:
        for officer in filing.officers:
            if len(entries) >= limit:
                return entries
            entries.append(
                registry_candidate(
                    name=officer.name,
                    entry_type="person",
                    context=_context_for(officer, organization),
                    city=organization.city,
                    state=organization.state,
                    issue_areas=issue_areas,
                    website=None,
                    # Deduplication merges the same name at the same
                    # organization and flags it across different ones, so one
                    # officer serving two boards reaches a reviewer.
                    affiliated_org=organization.name,
                    source_url=filing.source_url,
                    today_iso=today_iso,
                )
            )
    return entries


def _context_for(officer: FilingOfficer, organization: RegistryOrganization) -> str:
    """Describe what the return actually asserts about a person."""
    role = officer.title or "an officer, director or trustee"
    return f"Listed as {role} of {organization.name} on its IRS Form 990."
