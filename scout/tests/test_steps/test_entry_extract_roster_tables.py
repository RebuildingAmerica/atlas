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
