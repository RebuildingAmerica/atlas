"""Line-delimited roster extraction tests."""

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
async def test_extracts_people_from_line_delimited_roster_blocks() -> None:
    """Some public rosters scrape as pipe-separated line blocks, not tables."""
    provider = UnusedProvider()
    page = PageContent(
        url="https://texasscorecard.com/directory/texas-house",
        title="Texas House",
        text="\n".join(
            [
                "|",
                "Alex Public",
                "|",
                "4 |",
                "Jan 14, 2025 to Jan 12, 2027 |",
                "Democrat |",
                "|",
                "Jordan Civic",
                "|",
                "11 |",
                "Jan 14, 2025 to Jan 12, 2027 |",
                "Republican |",
                "|",
                "Broken Block",
                "|",
                "not a district |",
                "Jan 14, 2025 to Jan 12, 2027 |",
                "Democrat |",
            ]
        ),
    )

    entries = await extract_page_entries(
        page,
        provider,
        "Texas",
        "TX",
        store=None,
        run_id=None,
        reuse_cached_extractions=False,
    )

    assert [entry.name for entry in entries] == ["Alex Public", "Jordan Civic"]
    assert provider.calls == []
    assert entries[0].state == "TX"
    assert entries[0].affiliated_org == "State legislature"
    assert "District 4" in entries[0].description
