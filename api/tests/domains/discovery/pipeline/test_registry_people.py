"""Reading the IRS returns of the organizations a run found."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from atlas_discovery_engine import (
    FilingOfficer,
    FilingOfficerProvider,
    IrsFilingOfficerProvider,
    OrganizationFiling,
    ProPublicaRegistryProvider,
    RegistryOrganization,
)

from atlas.domains.discovery.pipeline import registry_people
from atlas.domains.discovery.pipeline.registry_people import (
    build_filing_provider,
    collect_filing_officers,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

ORG_URL = ProPublicaRegistryProvider.ORGANIZATION_URL


def _org(ein: str, name: str = "Housing Trust") -> RegistryOrganization:
    return RegistryOrganization(
        name=name,
        city="Lincoln",
        state="NE",
        registry_id=ein,
        source_url=f"{ORG_URL}/{ein}",
    )


def _filing(ein: str, *names: str) -> OrganizationFiling:
    return OrganizationFiling(
        ein=ein,
        object_id=f"2025{ein.zfill(14)}",
        officers=tuple(FilingOfficer(name, "Director") for name in names),
    )


class _FilingsByEin(FilingOfficerProvider):
    """Answers from a fixed table and records each batch it was asked for."""

    def __init__(self, filings: dict[str, OrganizationFiling]) -> None:
        self._filings = filings
        self.batches: list[list[str]] = []

    async def filings_for(self, eins: Sequence[str]) -> list[OrganizationFiling]:
        self.batches.append(list(eins))
        return [self._filings[ein] for ein in eins if ein in self._filings]


class TestCollectFilingOfficers:
    @pytest.mark.asyncio
    async def test_pairs_each_filing_with_its_organization(self) -> None:
        """A person record needs the organization the return belongs to."""
        provider = _FilingsByEin({"2": _filing("2", "Ana Ortiz")})

        pairs = await collect_filing_officers(
            provider, [_org("1"), _org("2", "Food Bank")], limit=10
        )

        assert [(org.name, filing.ein) for org, filing in pairs] == [("Food Bank", "2")]

    @pytest.mark.asyncio
    async def test_stops_looking_up_batches_once_the_budget_is_met(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Every lookup reads IRS archives, so a run spends no more than it keeps."""
        monkeypatch.setattr(registry_people, "_ORGANIZATIONS_PER_LOOKUP", 2)
        provider = _FilingsByEin({ein: _filing(ein, f"Person {ein}") for ein in "12345"})
        organizations = [_org(ein) for ein in "12345"]

        pairs = await collect_filing_officers(provider, organizations, limit=2)

        assert provider.batches == [["1", "2"]]
        assert len(pairs) == 2


class TestBuildFilingProvider:
    def test_no_budget_means_no_lookup_and_no_network(self) -> None:
        assert build_filing_provider(0) is None

    def test_a_budget_yields_the_irs_adapter(self) -> None:
        assert isinstance(build_filing_provider(50), IrsFilingOfficerProvider)
