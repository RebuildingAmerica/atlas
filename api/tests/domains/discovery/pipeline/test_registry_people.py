"""Turning officers named on IRS returns into person candidates."""

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
    filing_officers_to_entries,
    is_filing_corroborated,
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


class TestIsFilingCorroborated:
    def test_the_page_of_one_return_corroborates(self) -> None:
        """That page lists the person, so it is the evidence the gate wants."""
        assert is_filing_corroborated([f"{ORG_URL}/470123456/202510729349300100/full"]) is True

    @pytest.mark.parametrize(
        "url",
        [
            f"{ORG_URL}/470123456",
            f"{ORG_URL}/470123456/202510729349300100",
            f"{ORG_URL}/470123456/202510729349300100/summary",
            f"{ORG_URL}/ein/202510729349300100/full",
            f"{ORG_URL}/470123456/latest/full",
            "https://example.org/nonprofits/organizations/470123456/202510729349300100/full",
            "https://projects.propublica.org/elsewhere/470123456/202510729349300100/full",
        ],
        ids=[
            "register page",
            "no page",
            "other page",
            "non-numeric ein",
            "non-numeric return",
            "other host",
            "other path",
        ],
    )
    def test_nothing_short_of_a_return_page_corroborates_a_person(self, url: str) -> None:
        """A register page proves an organization filed; it names nobody."""
        assert is_filing_corroborated([url]) is False

    def test_a_record_citing_nothing_is_not_corroborated(self) -> None:
        assert is_filing_corroborated([]) is False


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


class TestFilingOfficersToEntries:
    def test_cites_the_return_and_names_the_role(self) -> None:
        """What a visitor reads is exactly what the return asserts."""
        filing = OrganizationFiling(
            "7", "202510729349300100", (FilingOfficer("Ana Ortiz", "Treasurer"),)
        )

        [entry] = filing_officers_to_entries(
            [(_org("7", "Food Bank"), filing)],
            issue_areas=["food_security"],
            today_iso="2026-09-12",
            limit=10,
        )

        assert entry["name"] == "Ana Ortiz"
        assert entry["entry_type"] == "person"
        assert entry["affiliated_org"] == "Food Bank"
        assert entry["description"] == "Listed as Treasurer of Food Bank on its IRS Form 990."
        assert entry["source_urls"] == [filing.source_url]
        assert entry["source_types"] == ["government_record"]
        assert (entry["city"], entry["state"]) == ("Lincoln", "NE")

    def test_describes_an_untitled_officer_without_inventing_a_role(self) -> None:
        filing = OrganizationFiling("7", "202510729349300100", (FilingOfficer("Eli Park", None),))

        [entry] = filing_officers_to_entries(
            [(_org("7", "Food Bank"), filing)], issue_areas=[], today_iso="2026-09-12", limit=10
        )

        assert entry["description"] == (
            "Listed as an officer, director or trustee of Food Bank on its IRS Form 990."
        )

    def test_stops_at_the_people_budget_mid_filing(self) -> None:
        """An 80-trustee board does not blow through a run's budget."""
        entries = filing_officers_to_entries(
            [(_org("1"), _filing("1", "A", "B")), (_org("2"), _filing("2", "C"))],
            issue_areas=[],
            today_iso="2026-09-12",
            limit=2,
        )

        assert [entry["name"] for entry in entries] == ["A", "B"]


class TestBuildFilingProvider:
    def test_no_budget_means_no_lookup_and_no_network(self) -> None:
        assert build_filing_provider(0) is None

    def test_a_budget_yields_the_irs_adapter(self) -> None:
        assert isinstance(build_filing_provider(50), IrsFilingOfficerProvider)
