"""Structured state senate roster extraction tests."""

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
async def test_extracts_state_senators_from_party_office_blocks() -> None:
    """State senate pages can publish member blocks instead of tables."""
    provider = UnusedProvider()
    page = PageContent(
        url="https://www.senate.ca.gov/senators",
        title="Senators",
        text="\n".join(
            [
                "Current Membership:",
                "Benjamin Allen",
                "(D)Capitol Office",
                "Capitol Office, 1021 O Street, Suite 7610, Sacramento, CA 95814",
                "District Office",
                "Vacancy",
                "(D)Capitol Office",
                "Capitol Office, 1021 O Street, Suite 0000, Sacramento, CA 95814",
                "District Office",
                "Marie Alvarado-Gil",
                "(R)Capitol Office",
                "Capitol Office, 1021 O Street, Suite 7240, Sacramento, CA 95814",
                "District Office",
            ]
        ),
    )

    entries = await extract_page_entries(
        page,
        provider,
        "California",
        "CA",
        store=None,
        run_id=None,
        reuse_cached_extractions=False,
    )

    assert [entry.name for entry in entries] == ["Benjamin Allen", "Marie Alvarado-Gil"]
    assert provider.calls == []
    assert entries[0].affiliated_org == "California State Senate"
    assert "Capitol Office, 1021 O Street" in entries[0].extraction_context
