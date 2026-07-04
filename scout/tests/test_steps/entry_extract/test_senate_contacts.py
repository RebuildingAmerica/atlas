"""Structured Senate contact roster extraction tests."""

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
async def test_extracts_senators_from_contact_blocks() -> None:
    """Senate XML contact blocks should not require LLM extraction."""
    provider = UnusedProvider()
    page = PageContent(
        url="https://www.senate.gov/general/contact_information/senators_cfm.xml",
        title="Senators",
        text="\n".join(
            [
                "Alsobrooks (D-MD)",
                "Alsobrooks",
                "Angela D.",
                "D",
                "MD",
                "374 Russell Senate Office Building Washington DC 20510",
                "(202) 224-4524",
                "https://alsobrooks.senate.gov/",
                "https://alsobrooks.senate.gov/",
                "Class I",
                "A000382",
                "Majority Whip",
                "Bennet (D-CO)",
                "Bennet",
                "Michael F.",
                "D",
                "CO",
                "261 Russell Senate Office Building Washington DC 20510",
                "(202) 224-5852",
                "https://www.bennet.senate.gov/public/index.cfm/contact",
                "https://www.bennet.senate.gov",
                "Class III",
                "B001267",
                "Broken (R-TX)",
                "Broken",
                "Example",
                "D",
                "TX",
                "Address",
                "(202) 224-0000",
                "https://example.test/contact",
                "https://example.test",
                "NoWebsite (R-WY)",
                "NoWebsite",
                "Example",
                "R",
                "WY",
                "Address",
                "(202) 224-0001",
                "Contact form unavailable",
                "Contact form unavailable",
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

    assert [entry.name for entry in entries] == ["Angela D. Alsobrooks", "Michael F. Bennet"]
    assert provider.calls == []
    assert entries[0].state == "MD"
    assert entries[0].website == "https://alsobrooks.senate.gov/"
    assert "374 Russell Senate Office Building" in entries[0].extraction_context
