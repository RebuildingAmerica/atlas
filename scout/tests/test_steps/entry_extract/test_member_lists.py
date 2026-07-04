"""Structured state member list extraction tests."""

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
async def test_extracts_members_from_plain_text_roster_blocks() -> None:
    """Official card-list rosters should extract without LLM calls."""
    provider = UnusedProvider()
    page = PageContent(
        url="https://webapi.assembly.ca.gov/member-data/api/v1/members",
        title="Members",
        text="\n".join(
            [
                "-",
                "Addis, Dawn",
                "District: 30",
                "Democrat",
                "Suite 4120",
                "View Details",
                "-",
                "Vacant, Member",
                "District: 03",
                "Vacant",
                "Suite 4730",
                "-",
                "Alanis, Juan",
                "District: 22",
                "Republican",
                "Suite 4640",
                "-",
                "Broken Member",
                "County: Test",
                "Democrat",
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

    assert [entry.name for entry in entries] == ["Dawn Addis", "Juan Alanis"]
    assert provider.calls == []
    assert entries[0].state == "CA"
    assert entries[0].affiliated_org == "California State Assembly"
    assert "District: 30" in entries[0].extraction_context
