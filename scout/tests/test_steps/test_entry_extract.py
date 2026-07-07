"""Tests for Step 3: entry_extract."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from atlas_scout.providers.base import Completion

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from atlas_shared import PageContent

    from atlas_scout.providers.base import Message


class _MockProvider:
    """A minimal LLM provider mock for testing."""

    def __init__(self, response_text: str = "[]", max_concurrent: int = 4) -> None:
        self._response_text = response_text
        self.max_concurrent = max_concurrent
        self.calls: list[list[Message]] = []

    async def complete(
        self,
        messages: list[Message],
        _response_schema: Any = None,
    ) -> Completion:
        self.calls.append(messages)
        return Completion(text=self._response_text)


def _make_entry_json(name: str = "Test Org", issue: str = "housing_affordability") -> str:
    return json.dumps(
        [
            {
                "name": name,
                "type": "organization",
                "description": "A local housing org.",
                "city": "Austin",
                "state": "TX",
                "geo_specificity": "local",
                "issue_areas": [issue],
                "affiliated_org": None,
                "website": "https://testorg.org",
                "email": "info@testorg.org",
                "social_media": {},
                "extraction_context": "Test org helps with housing.",
            }
        ]
    )


def _make_entry_json_without_location(name: str = "Jane Doe") -> str:
    return json.dumps(
        [
            {
                "name": name,
                "type": "person",
                "description": "A named local official.",
                "city": None,
                "state": None,
                "geo_specificity": "local",
                "issue_areas": ["local_government_and_civic_engagement"],
                "affiliated_org": None,
                "website": None,
                "email": None,
                "social_media": {},
                "extraction_context": f"{name} serves the city.",
            }
        ]
    )


async def _pages_iter(*pages: PageContent) -> AsyncIterator[PageContent]:
    for page in pages:
        yield page
