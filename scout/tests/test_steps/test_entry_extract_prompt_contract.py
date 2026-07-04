"""Entry extraction prompt contract tests."""

from __future__ import annotations

import pytest
from atlas_shared import PageContent

from atlas_scout.providers.base import Completion, Message
from atlas_scout.steps.entry_extract import _build_system_prompt, _pass_identify


class CapturingProvider:
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
async def test_identify_prompt_accepts_table_rows_as_source_quotes() -> None:
    """Roster tables need row-level evidence, not only prose sentences."""
    provider = CapturingProvider()
    page = PageContent(
        url="https://example.test/representatives",
        title="Representatives",
        text="| District | Name |\n|---|---|\n| 1st | Moore, Barry |",
    )

    await _pass_identify(page, provider)

    assert "sentence or table row" in provider.calls[0][0].content


def test_enrichment_prompt_accepts_table_rows_as_extraction_context() -> None:
    """Structured entries should be allowed to cite roster rows as context."""
    prompt = _build_system_prompt("United States", "US")

    assert "sentence, table row, or source-text fragment" in prompt
