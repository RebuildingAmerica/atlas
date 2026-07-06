"""Structured roster table extraction tests."""

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
async def test_extracts_people_from_public_office_roster_tables() -> None:
    """Official roster tables are source-backed enough to extract without LLM."""
    provider = UnusedProvider()
    page = PageContent(
        url="https://www.house.gov/representatives",
        title="Representatives",
        text="\n".join(
            [
                "Directory of Representatives",
                "| Name | Favorite color |",
                "|---|---|",
                "| Not a roster | Blue |",
                "| District | Name | Party | Office Room | Phone | Committee Assignment |",
                "|---|---|---|---|---|---|",
                "| 1st | Moore, Barry | R | 1511 LHOB | (202) 225-2901 | Agriculture|Judiciary |",
                "| 2nd | Figures, Shomari | D | 225 CHOB | (202) 225-4931 | Agriculture |",
                "| 14th | Swalwell, Eric- Vacancy | D | 174 CHOB | (202) 225-5065 | |",
                "| 3rd |  | R | 0000 CHOB | (202) 225-0000 | |",
                "| Office | Name |",
                "|---|---|",
                "| Mayor | Jane Doe |",
                "| Council | Row, Short |",
            ]
        ),
    )

    entries = await extract_page_entries(
        page,
        provider,
        "United States",
        "US",
        store=None,
        run_id=None,
        reuse_cached_extractions=False,
    )

    assert [entry.name for entry in entries] == [
        "Barry Moore",
        "Shomari Figures",
        "Jane Doe",
        "Short Row",
    ]
    assert provider.calls == []
    assert entries[0].state == "US"
    assert entries[0].website == "https://www.house.gov/representatives"
    assert entries[0].issue_areas == [
        "political_polarization_and_democratic_norms",
        "electoral_reform",
    ]
    assert entries[0].extraction_context.startswith("| 1st | Moore, Barry |")


@pytest.mark.asyncio
async def test_extracts_people_from_plain_text_office_roster_blocks() -> None:
    """City roster pages often scrape as repeated name then office lines."""
    provider = UnusedProvider()
    page = PageContent(
        url="https://example.gov/mayor-city-council",
        title="Mayor and City Council",
        text="\n".join(
            [
                "Mayor & City Council",
                "Top Requests",
                "Mayor and City Council positions are elected by registered voters in the city.",
                "Shelley Berkley",
                "Mayor",
                "Learn more",
                "Brian Knudsen",
                "Councilman Ward 1",
                "Learn more",
                "Councilwoman Ward 2",
                "Learn more",
            ]
        ),
    )

    entries = await extract_page_entries(
        page,
        provider,
        "Las Vegas",
        "NV",
        store=None,
        run_id=None,
        reuse_cached_extractions=False,
    )

    assert [entry.name for entry in entries] == ["Shelley Berkley", "Brian Knudsen"]
    assert (
        entries[0].description == "Shelley Berkley is listed as Mayor in the public office roster."
    )
    assert entries[1].description == (
        "Brian Knudsen is listed as Councilman Ward 1 in the public office roster."
    )
    assert entries[0].city == "Las Vegas"
    assert entries[0].issue_areas == ["local_government_and_civic_engagement"]
    assert provider.calls == []


@pytest.mark.asyncio
async def test_extracts_people_from_plain_text_board_roster_blocks() -> None:
    """Board pages often list a name, board role, affiliation, and term lines."""
    provider = UnusedProvider()
    page = PageContent(
        url="https://www.southernnevadahealthdistrict.org/about-us/board-of-health/board-members",
        title="Board Members",
        text="\n".join(
            [
                "Board Members",
                "Scott Black",
                "Chair",
                "Mayor Pro Tempore, City of North Las Vegas",
                "Term 7/1/2025 - 11/30/2026",
                "Frank Nemec, M.D.",
                "Vice Chair",
                "Physician, Member-At-Large",
                "Term 7/1/2026 - 6/30/2028",
                "Bobbette Bond",
                "Business/Industry",
                "Member-at-Large",
                "Term 7/1/2026 - 6/30/2028",
            ]
        ),
    )

    entries = await extract_page_entries(
        page,
        provider,
        "Las Vegas",
        "NV",
        store=None,
        run_id=None,
        reuse_cached_extractions=False,
    )

    assert [entry.name for entry in entries] == ["Scott Black", "Frank Nemec", "Bobbette Bond"]
    assert entries[0].description == "Scott Black is listed as Chair in the public office roster."
    assert entries[1].description == (
        "Frank Nemec is listed as Vice Chair in the public office roster."
    )
    assert entries[0].affiliated_org == "Southern Nevada Health District"
    assert provider.calls == []


@pytest.mark.asyncio
async def test_extracts_people_from_numbered_council_roster_rows() -> None:
    """Large council directory pages should not require an LLM to finish."""
    provider = UnusedProvider()
    page = PageContent(
        url="https://example.gov/districts",
        title="Council Members and Districts",
        text="\n".join(
            [
                "No.",
                "Member",
                "Borough",
                "Party",
                "Neighborhoods",
                "Email",
                "1",
                "Christopher Marte",
                "Manhattan",
                "Democrat",
                "Financial District",
                "Copy",
                "5",
                "Speaker Julie Menin",
                "Manhattan",
                "Democrat",
                "Upper East Side",
                "Copy",
                "27",
                "Deputy Speaker Dr. Nantasha Williams",
                "Queens",
                "Democrat",
                "Jamaica",
                "Copy",
            ]
        ),
    )

    entries = await extract_page_entries(
        page,
        provider,
        "New York",
        "NY",
        store=None,
        run_id=None,
        reuse_cached_extractions=False,
    )

    assert [entry.name for entry in entries] == [
        "Christopher Marte",
        "Julie Menin",
        "Nantasha Williams",
    ]
    assert entries[1].description == (
        "Julie Menin is listed as a public officeholder for District 5 in Manhattan "
        "with party marker Democrat."
    )
    assert entries[2].extraction_context.startswith("27\nDeputy Speaker Dr. Nantasha Williams")
    assert provider.calls == []


@pytest.mark.asyncio
async def test_extracts_people_from_numbered_pipe_roster_rows_without_header() -> None:
    """Some directory pages produce clean table rows without a header row."""
    provider = UnusedProvider()
    page = PageContent(
        url="https://example.gov/districts",
        title="Council Members and Districts",
        text="\n".join(
            [
                "Council Members & Districts",
                "| 1 | Christopher Marte | Manhattan | Democrat | Financial District | Copy | |",
                "| 5 | Speaker Julie Menin | Manhattan | Democrat | Upper East Side | Copy | |",
                "| 27 | Deputy Speaker Dr. Nantasha Williams | Queens | Democrat | Jamaica | Copy | |",
                "| 49 | Majority Whip Kamillah M. Hanks | Staten Island | Democrat | St. George | Copy | |",
                "| 99 | Council District | Queens | Democrat | Broken | Copy | |",
            ]
        ),
    )

    entries = await extract_page_entries(
        page,
        provider,
        "New York",
        "NY",
        store=None,
        run_id=None,
        reuse_cached_extractions=False,
    )

    assert [entry.name for entry in entries] == [
        "Christopher Marte",
        "Julie Menin",
        "Nantasha Williams",
        "Kamillah M. Hanks",
    ]
    assert entries[0].description == (
        "Christopher Marte is listed as a public officeholder for District 1 in Manhattan "
        "with party marker Democrat."
    )
    assert entries[2].extraction_context.startswith("| 27 | Deputy Speaker Dr. Nantasha Williams")
    assert provider.calls == []


@pytest.mark.asyncio
async def test_extracts_people_from_tabular_official_roster_rows() -> None:
    """Official pages often render tables as tab-delimited text rows."""
    provider = UnusedProvider()
    page = PageContent(
        url="https://clerk.lacity.gov/articles/current-elected-officials",
        title="Current Elected Officials",
        text="\n".join(
            [
                "Current Elected Officials",
                "Citywide Offices",
                (
                    "Office\tName\tRegistration\tDate Originally Assumed Office\tTerm No."
                    "\tExp. Date of Current Term"
                ),
                "Mayor\tKaren Ruth Bass\t2,213,445\t12-12-22\t1\t12-13-26",
                "City Attorney\tHydee Feldstein Soto\t2,213,445\t12-12-22\t1\t12-13-26",
                "City Councilmembers",
                (
                    "District\tName\tRegistration\tDate Originally Assumed Office\tTerm No."
                    "\tExp. Date of Current Term"
                ),
                "1\tEunisses Hernandez\t110,773\t12-12-22\t1\t12-13-26",
                "2\tAdrin Nazarian\t143,951\t12-9-24\t1\t12-10-28",
                "Total\t\t2,213,445",
            ]
        ),
    )

    entries = await extract_page_entries(
        page,
        provider,
        "Los Angeles",
        "CA",
        store=None,
        run_id=None,
        reuse_cached_extractions=False,
    )

    assert [entry.name for entry in entries] == [
        "Karen Ruth Bass",
        "Hydee Feldstein Soto",
        "Eunisses Hernandez",
        "Adrin Nazarian",
    ]
    assert entries[0].description == (
        "Karen Ruth Bass is listed as Mayor in the Citywide Offices public roster."
    )
    assert entries[2].description == (
        "Eunisses Hernandez is listed as District 1 in the City Councilmembers public roster."
    )
    assert entries[0].affiliated_org == "Los Angeles City Clerk"
    assert entries[0].city == "Los Angeles"
    assert entries[0].issue_areas == ["local_government_and_civic_engagement"]
    assert provider.calls == []
