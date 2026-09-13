"""Officers read from IRS returns, located through ProPublica."""

from __future__ import annotations

import httpx
import pytest
from defusedxml import DefusedXmlException

from atlas_discovery_engine.filings import (
    IRS_DOWNLOADS_PAGE,
    FilingOfficer,
    IrsFilingOfficerProvider,
    OrganizationFiling,
    parse_officers,
)
from atlas_discovery_engine.registry import ProPublicaRegistryProvider

from .support import FakeHost, build_zip, filing_xml, officer

ORG_URL = ProPublicaRegistryProvider.ORGANIZATION_URL
NEW = "202510729349300100"
OLD = "202410729349300200"
ARCHIVE_2025 = "https://apps.irs.gov/pub/epostcard/990/xml/2025/2025_TEOS_XML_01A.zip"
ARCHIVE_2025_B = "https://apps.irs.gov/pub/epostcard/990/xml/2025/2025_TEOS_XML_05B.zip"
ARCHIVE_2024 = "https://apps.irs.gov/pub/epostcard/990/xml/2024/2024_TEOS_XML_01A.zip"


def _org_page(*object_ids: str) -> str:
    links = "".join(
        f'<a href="/nonprofits/download-xml?object_id={oid}">XML</a>' for oid in object_ids
    )
    return f"<html><body>{links}</body></html>"


def _downloads_page(*urls: str) -> str:
    """The IRS page, which surrounds its archive links with everything else."""
    noise = (
        '<a href="/charities-non-profits">Charities</a>'
        '<a href="https://apps.irs.gov/pub/epostcard/990/xml/2025/index_2025.csv">Index</a>'
        '<a href="https://apps.irs.gov/pub/epostcard/990/xml/2025/2024_TEOS_XML_01A.zip">Mislabeled</a>'
        '<a href="https://example.org/2025/2025_TEOS_XML_01A.zip">Mirror</a>'
        "<a>No href</a>"
    )
    return "<html>" + noise + "".join(f'<a href="{url}">zip</a>' for url in urls) + "</html>"


def _provider(host: FakeHost) -> IrsFilingOfficerProvider:
    return IrsFilingOfficerProvider(client_factory=host.client)


class TestParseOfficers:
    def test_reads_names_and_titles_from_each_return_form(self) -> None:
        """Form 990, 990-EZ and 990-PF each name officers under a different tag."""
        document = filing_xml(
            officer("Ana Ortiz", "President"),
            officer("Ben Lee", "Treasurer", tag="OfficerDirectorTrusteeEmplGrp"),
            officer("Cy Diaz", "Trustee", tag="OfficerDirTrstKeyEmplGrp"),
        )

        assert parse_officers(document) == [
            FilingOfficer("Ana Ortiz", "President"),
            FilingOfficer("Ben Lee", "Treasurer"),
            FilingOfficer("Cy Diaz", "Trustee"),
        ]

    def test_skips_a_business_listed_as_an_officer(self) -> None:
        """A management company is not a person Atlas should list."""
        business = (
            "<Form990PartVIISectionAGrp><BusinessName><BusinessNameLine1Txt>"
            "Acme Mgmt LLC</BusinessNameLine1Txt></BusinessName></Form990PartVIISectionAGrp>"
        )
        document = filing_xml(business, officer("Ana Ortiz", "Chair"))

        assert parse_officers(document) == [FilingOfficer("Ana Ortiz", "Chair")]

    def test_keeps_a_person_once_and_cleans_the_text(self) -> None:
        """A filer that lists someone twice, or pads a name, still yields one clean row."""
        document = filing_xml(
            officer("  Dana   O&apos;Neil ", "   "),
            officer("DANA O'NEIL", "Director"),
            officer("Eli Park"),
        )

        assert parse_officers(document) == [
            FilingOfficer("Dana O'Neil", None),
            FilingOfficer("Eli Park", None),
        ]

    def test_skips_officers_the_return_marks_as_former(self) -> None:
        """Someone who left during the year is not listed as holding the role."""
        former = (
            "<Form990PartVIISectionAGrp><PersonNm>Old Chair</PersonNm>"
            "<TitleTxt>Chair</TitleTxt><FormerOfcrDirectorTrusteeInd>X"
            "</FormerOfcrDirectorTrusteeInd></Form990PartVIISectionAGrp>"
        )
        document = filing_xml(former, officer("Ana Ortiz", "Chair"))

        assert parse_officers(document) == [FilingOfficer("Ana Ortiz", "Chair")]

    def test_skips_a_departure_written_into_the_name_or_title(self) -> None:
        """Filers write 'RESIGNED' or 'FORMER' instead of setting the flag."""
        document = filing_xml(
            officer("ANNE GRUENWALD RESIGNED", "FORMER PRESI"),
            officer("Ben Lee", "Former Treasurer"),
            officer("Cy Diaz Deceased"),
            officer("Dee Fox", "Treasurer"),
        )

        assert parse_officers(document) == [FilingOfficer("Dee Fox", "Treasurer")]

    def test_refuses_a_return_that_expands_entities(self) -> None:
        """A hostile document is rejected rather than expanded in memory."""
        bomb = (
            b'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]>'
            b"<r><Form990PartVIISectionAGrp><PersonNm>&b;</PersonNm></Form990PartVIISectionAGrp></r>"
        )

        with pytest.raises(DefusedXmlException):
            parse_officers(bomb)


class TestIrsFilingOfficerProvider:
    async def test_reads_officers_from_the_newest_return(self) -> None:
        """The run cites the exact return a name came from."""
        host = FakeHost(
            pages={
                f"{ORG_URL}/111": _org_page(OLD, NEW, NEW),
                IRS_DOWNLOADS_PAGE: _downloads_page(ARCHIVE_2025, ARCHIVE_2025, ARCHIVE_2024),
            },
            archives={
                ARCHIVE_2025: build_zip(
                    {f"{NEW}_public.xml": filing_xml(officer("Ana Ortiz", "Chair"))}
                ),
                ARCHIVE_2024: build_zip({f"{OLD}_public.xml": filing_xml(officer("Old Name"))}),
            },
        )

        filings = await _provider(host).filings_for(["111"])

        assert filings == [
            OrganizationFiling("111", NEW, (FilingOfficer("Ana Ortiz", "Chair"),)),
        ]
        assert filings[0].source_url == f"{ORG_URL}/111/{NEW}/full"
        assert f"GET {ARCHIVE_2024}" in host.requests
        assert host.requests.count(f"HEAD {ARCHIVE_2025}") == 1

    async def test_falls_back_to_the_prior_return_when_the_newest_names_nobody(self) -> None:
        """A newest return with no officer rows is not the end of the search."""
        host = FakeHost(
            pages={
                f"{ORG_URL}/222": _org_page(NEW, OLD),
                IRS_DOWNLOADS_PAGE: _downloads_page(ARCHIVE_2025, ARCHIVE_2024),
            },
            archives={
                ARCHIVE_2025: build_zip({f"{NEW}_public.xml": filing_xml()}),
                ARCHIVE_2024: build_zip({f"{OLD}_public.xml": filing_xml(officer("Ben Lee"))}),
            },
        )

        filings = await _provider(host).filings_for(["222"])

        assert [(f.object_id, f.officers) for f in filings] == [
            (OLD, (FilingOfficer("Ben Lee", None),)),
        ]

    async def test_stops_reading_a_year_once_every_return_is_found(self) -> None:
        """A later archive is never opened for a return an earlier one held."""
        host = FakeHost(
            pages={
                f"{ORG_URL}/333": _org_page(NEW),
                IRS_DOWNLOADS_PAGE: _downloads_page(ARCHIVE_2025, ARCHIVE_2025_B),
            },
            archives={
                ARCHIVE_2025: build_zip({f"{NEW}_public.xml": filing_xml(officer("Cy Diaz"))}),
                ARCHIVE_2025_B: build_zip({"unrelated_public.xml": b"x"}),
            },
        )

        filings = await _provider(host).filings_for(["333"])

        assert len(filings) == 1
        assert not any(ARCHIVE_2025_B in request for request in host.requests)

    async def test_skips_failures_without_losing_the_rest_of_the_run(self) -> None:
        """One refused page, broken archive or unreadable return drops only that filer."""
        host = FakeHost(
            pages={
                f"{ORG_URL}/401": 503,
                f"{ORG_URL}/402": _org_page("202310729349300300"),
                f"{ORG_URL}/403": _org_page(NEW),
                f"{ORG_URL}/404": _org_page(OLD),
                IRS_DOWNLOADS_PAGE: _downloads_page(ARCHIVE_2025_B, ARCHIVE_2025, ARCHIVE_2024),
            },
            archives={
                ARCHIVE_2025_B: b"not a zip",
                ARCHIVE_2025: build_zip({f"{NEW}_public.xml": filing_xml(officer("Dee Fox"))}),
                ARCHIVE_2024: build_zip({f"{OLD}_public.xml": filing_xml(officer("Eve Kim"))}),
            },
        )
        provider = _provider(host)

        filings = await provider.filings_for(["401", "402", "403"])
        assert [f.ein for f in filings] == ["403"]

        # The 2024 directory reads cleanly, then its member range is refused.
        original = provider._locate

        async def locate_then_break(client: httpx.AsyncClient, ids: set[str]) -> object:
            located = await original(client, ids)
            host.failing_ranges.add(ARCHIVE_2024)
            return located

        provider._locate = locate_then_break  # type: ignore[method-assign]
        assert await provider.filings_for(["404"]) == []

    async def test_reads_the_irs_archive_list_once_per_provider(self) -> None:
        """A run looks returns up in batches; the monthly list is fetched once."""
        host = FakeHost(
            pages={
                f"{ORG_URL}/701": _org_page(NEW),
                f"{ORG_URL}/702": _org_page(NEW),
                IRS_DOWNLOADS_PAGE: _downloads_page(ARCHIVE_2025),
            },
            archives={
                ARCHIVE_2025: build_zip({f"{NEW}_public.xml": filing_xml(officer("Gus Ray"))})
            },
        )
        provider = _provider(host)

        await provider.filings_for(["701"])
        await provider.filings_for(["702"])

        assert host.requests.count(f"GET {IRS_DOWNLOADS_PAGE}") == 1

    async def test_finds_nothing_when_the_irs_archive_list_is_unavailable(self) -> None:
        """Without the list of archives there is nowhere to read a return from."""
        host = FakeHost(pages={f"{ORG_URL}/501": _org_page(NEW), IRS_DOWNLOADS_PAGE: 500})

        assert await _provider(host).filings_for(["501"]) == []

    async def test_asks_the_irs_nothing_for_filers_with_no_electronic_returns(self) -> None:
        """A paper filer has no object ids, so no archive is worth listing."""
        host = FakeHost(pages={f"{ORG_URL}/601": _org_page()})

        assert await _provider(host).filings_for(["601"]) == []
        assert not any(IRS_DOWNLOADS_PAGE in request for request in host.requests)

    async def test_builds_a_real_client_when_none_is_injected(self) -> None:
        """Production constructs its own client with the Atlas user agent."""
        client = IrsFilingOfficerProvider(user_agent="AtlasBot/test")._client_factory()

        async with client:
            assert client.headers["User-Agent"] == "AtlasBot/test"
