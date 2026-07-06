"""Structured resource extraction tests."""

from __future__ import annotations

import pytest
from atlas_shared import PageContent

from atlas_scout.providers.base import Completion, Message
from atlas_scout.steps.entry_extract import extract_page_entries


class UnusedProvider:
    max_concurrent = 1

    def __init__(self) -> None:
        self.calls: list[list[Message]] = []

    async def complete(
        self,
        messages: list[Message],
        _response_schema: object = None,
    ) -> Completion:
        self.calls.append(messages)
        return Completion(text="[]")


@pytest.mark.asyncio
async def test_extracts_people_from_structured_csv_with_headers() -> None:
    provider = UnusedProvider()
    page = PageContent(
        url="https://example.gov/candidates.csv",
        title="candidates.csv",
        text="\n".join(
            [
                "name,office,office_state,district,party,election_year,city,state",
                '"DOE, JANE",House,CA,12,Democratic,2026,Los Angeles,CA',
                '"SMITH, JOHN",Mayor,TX,,Independent,2026,Dallas,TX',
            ]
        ),
        structured_data={"resource_format": "csv"},
    )

    entries = await extract_page_entries(
        page,
        provider,
        "",
        "",
        store=None,
        run_id=None,
        reuse_cached_extractions=False,
    )

    assert [entry.name for entry in entries] == ["Jane Doe", "John Smith"]
    assert entries[0].city == "Los Angeles"
    assert entries[0].state == "CA"
    assert entries[0].description == (
        "Jane Doe is listed as a House candidate for CA District 12 in 2026 "
        "with party marker Democratic."
    )
    assert entries[0].source_url == "https://example.gov/candidates.csv"
    assert entries[0].extraction_context.startswith("name=DOE, JANE; office=House")
    assert entries[0].issue_areas == [
        "political_polarization_and_democratic_norms",
        "electoral_reform",
    ]
    assert provider.calls == []


@pytest.mark.asyncio
async def test_extracts_people_from_headerless_structured_resource_columns() -> None:
    provider = UnusedProvider()
    page = PageContent(
        url="https://example.gov/candidates.zip",
        title="candidates.txt",
        text="\n".join(
            [
                "P000001|DOE, JANE|Democratic|2026|CA|House|12|Los Angeles|CA",
                "P000002|SMITH, JOHN|Independent|2026|TX|Mayor||Dallas|TX",
            ]
        ),
        structured_data={
            "resource_format": "zip",
            "structured_columns": [
                "id",
                "name",
                "party",
                "election_year",
                "office_state",
                "office",
                "district",
                "city",
                "state",
            ],
        },
    )

    entries = await extract_page_entries(
        page,
        provider,
        "",
        "",
        store=None,
        run_id=None,
        reuse_cached_extractions=False,
    )

    assert [entry.name for entry in entries] == ["Jane Doe", "John Smith"]
    assert entries[1].description == (
        "John Smith is listed as a Mayor candidate for TX in 2026 with party marker Independent."
    )
    assert entries[1].extraction_context.startswith("id=P000002; name=SMITH, JOHN")
    assert provider.calls == []


@pytest.mark.asyncio
async def test_structured_resource_names_strip_titles_and_place_suffixes() -> None:
    provider = UnusedProvider()
    page = PageContent(
        url="https://example.gov/candidates.zip",
        title="candidates.txt",
        text="\n".join(
            [
                "P000003|BAKER, HOWARD H JR SENATOR|Republican|1980|TN|Senate||HUNTSVILLE|TN",
                "P000004|BAILEY, MR. FRANK IRVING JR.|Democratic|1980|GA|House|5|RIVERDALE|GA",
                "P000005|VICK, CHARLES GORDON DD JD|Independent|1980|TN|House|9|MEMPHIS|TN",
            ]
        ),
        structured_data={
            "resource_format": "zip",
            "structured_columns": [
                "id",
                "name",
                "party",
                "election_year",
                "office_state",
                "office",
                "district",
                "city",
                "state",
            ],
        },
    )

    entries = await extract_page_entries(
        page,
        provider,
        "",
        "",
        store=None,
        run_id=None,
        reuse_cached_extractions=False,
    )

    assert [entry.name for entry in entries] == [
        "Howard H Baker Jr.",
        "Frank Irving Bailey Jr.",
        "Charles Gordon Vick",
    ]


@pytest.mark.asyncio
async def test_structured_resource_names_strip_spaced_credentials() -> None:
    provider = UnusedProvider()
    page = PageContent(
        url="https://example.gov/candidates.zip",
        title="candidates.txt",
        text="P000006|DOWDA, FREDRICK WILLIAM M D|Republican|1980|GA|House|5|ATLANTA|GA",
        structured_data={
            "resource_format": "zip",
            "structured_columns": [
                "id",
                "name",
                "party",
                "election_year",
                "office_state",
                "office",
                "district",
                "city",
                "state",
            ],
        },
    )

    entries = await extract_page_entries(
        page,
        provider,
        "",
        "",
        store=None,
        run_id=None,
        reuse_cached_extractions=False,
    )

    assert [entry.name for entry in entries] == ["Fredrick William Dowda"]


@pytest.mark.asyncio
async def test_extracts_campaign_finance_context_from_structured_rows() -> None:
    provider = UnusedProvider()
    page = PageContent(
        url="https://example.gov/individual-contributions.zip",
        title="individual-contributions.txt",
        text="C000001|DOE, JANE|LAS VEGAS|NV|TEACHER|SCHOOL DISTRICT|19800115|250",
        structured_data={
            "resource_format": "zip",
            "structured_columns": [
                "committee_id",
                "name",
                "city",
                "state",
                "occupation",
                "employer",
                "transaction_date",
                "transaction_amount",
            ],
        },
    )

    entries = await extract_page_entries(
        page,
        provider,
        "",
        "",
        store=None,
        run_id=None,
        reuse_cached_extractions=False,
    )

    assert len(entries) == 1
    assert entries[0].name == "Jane Doe"
    assert entries[0].description == (
        "Jane Doe is listed in a public campaign-finance transaction dated 19800115 "
        "for 250 with occupation TEACHER and employer SCHOOL DISTRICT."
    )
    assert entries[0].city == "LAS VEGAS"
    assert entries[0].state == "NV"
    assert entries[0].affiliated_org == "C000001"
