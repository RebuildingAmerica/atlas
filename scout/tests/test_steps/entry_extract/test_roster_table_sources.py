"""Roster-table source labeling tests."""

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
async def test_labels_state_roster_tables_with_state_legislature_source() -> None:
    """Source labels should not claim state rosters came from Congress."""
    provider = UnusedProvider()
    page = PageContent(
        url="https://example.test/state-house",
        title="State House",
        text="\n".join(
            [
                "| District | Member | Party |",
                "|---|---|---|",
                "| 4th | Public, Alex | Democratic |",
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

    assert [entry.name for entry in entries] == ["Alex Public"]
    assert entries[0].affiliated_org == "State legislature"
    assert provider.calls == []
