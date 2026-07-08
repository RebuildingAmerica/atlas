"""Shared fixtures for pipeline orchestrator tests."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

from atlas_shared import PageContent

from atlas_scout.providers.base import Completion


def build_mock_provider() -> AsyncMock:
    """Return a mock LLM provider that extracts a single test org."""
    provider = AsyncMock()
    provider.max_concurrent = 5
    provider.complete.return_value = Completion(
        text=json.dumps(
            [
                {
                    "name": "Test Org",
                    "type": "organization",
                    "description": "A test organization working on housing issues in Austin Texas",
                    "city": "Austin",
                    "state": "TX",
                    "geo_specificity": "local",
                    "issue_areas": ["housing_affordability"],
                    "website": "https://test.org",
                    "email": "info@test.org",
                    "social_media": None,
                    "affiliated_org": None,
                    "extraction_context": "Test org was mentioned...",
                }
            ]
        ),
        parsed=None,
    )
    return provider


class MockFetcher:
    """A minimal fetcher that returns one page."""

    max_concurrent = 1

    def bind_run(self, _run_id: str) -> None:
        return None

    async def fetch(self, url: str) -> PageContent:
        return self._page(url=url, task_id=None)

    async def fetch_tracked(self, url: str, task_id: str, _store) -> PageContent:
        return self._page(url=url, task_id=task_id)

    @staticmethod
    def _page(url: str, task_id: str | None) -> PageContent:
        return PageContent(
            url=url,
            text="Article about Test Org housing advocacy in Austin " * 50,
            title="Housing News",
            task_id=task_id,
        )


class StructuredFetcher:
    """Fetcher stub that returns structured CSV content."""

    max_concurrent = 1

    def bind_run(self, _run_id: str) -> None:
        return None

    async def fetch_tracked_verbose(
        self,
        url: str,
        task_id: str,
        _store: object,
    ) -> dict[str, object]:
        return {
            "url": url,
            "task_id": task_id,
            "page": PageContent(
                url="https://example.gov/candidates.csv",
                text="\n".join(
                    [
                        "name,office,office_state,district,party,election_year,city,state",
                        '"DOE, JANE",House,CA,12,Democratic,2026,Los Angeles,CA',
                        '"SMITH, JOHN",Mayor,TX,,Independent,2026,Dallas,TX',
                    ]
                ),
                title="candidates.csv",
                structured_data={"resource_format": "csv"},
            ),
            "status": "fetched",
            "error": None,
            "discovered_links": [],
        }


class BlockingProvider:
    """Provider stub that hangs after signalling work started."""

    max_concurrent = 1

    async def complete(self, _messages, _response_schema=None) -> Completion:
        from asyncio import Future

        await Future()
        return Completion(text="[]")  # pragma: no cover
