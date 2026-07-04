"""Plain-text roster table extraction tests."""

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
async def test_extracts_people_from_plain_text_roster_tables() -> None:
    """Some roster tables scrape as one cell per line instead of markdown rows."""
    provider = UnusedProvider()
    page = PageContent(
        url="https://en.wikipedia.org/wiki/Pennsylvania_House_of_Representatives",
        title="Pennsylvania House",
        text="\n".join(
            [
                "List of current representatives",
                "District",
                "Name",
                "Party",
                "Residence",
                "Counties",
                "Start",
                "1",
                "Pat Harkins",
                "Democratic",
                "Erie",
                "Erie",
                "2006",
                "2",
                "Robert Merski",
                "Democratic",
                "Erie",
                "Erie",
                "2018",
                "12",
                "Vacant",
                "Butler",
                "2026",
                "13",
                "John Lawrence",
                "Republican",
                "Franklin Township",
                "Chester",
                "2010",
            ]
        ),
    )

    entries = await extract_page_entries(
        page,
        provider,
        "Pennsylvania",
        "PA",
        store=None,
        run_id=None,
        reuse_cached_extractions=False,
    )

    assert [entry.name for entry in entries] == ["Pat Harkins", "Robert Merski", "John Lawrence"]
    assert provider.calls == []
    assert entries[0].state == "PA"
    assert entries[0].affiliated_org == "State legislature"
    assert "District 1" in entries[0].description
