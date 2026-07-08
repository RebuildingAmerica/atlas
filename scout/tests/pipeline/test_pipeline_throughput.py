"""Throughput-oriented pipeline behavior helpers."""

from __future__ import annotations

import asyncio
import json

from atlas_shared import PageContent

from atlas_scout.providers.base import Completion, Message


class _OverlappingProvider:
    def __init__(self, started: asyncio.Event) -> None:
        self.max_concurrent = 4
        self._started = started

    async def complete(
        self,
        _messages: list[Message],
        _response_schema=None,
    ) -> Completion:
        self._started.set()
        return Completion(
            text=json.dumps(
                [
                    {
                        "name": "Speed Org",
                        "type": "organization",
                        "description": "Fast moving local org",
                        "city": "Austin",
                        "state": "TX",
                        "geo_specificity": "local",
                        "issue_areas": ["housing_affordability"],
                        "website": "https://speed.org",
                        "email": "hello@speed.org",
                        "social_media": {},
                        "affiliated_org": None,
                        "extraction_context": "Speed Org is active locally.",
                    }
                ]
            )
        )


class _BlockingFetcher:
    def __init__(self, provider_started: asyncio.Event) -> None:
        self._provider_started = provider_started

    async def fetch_tracked(self, url: str, task_id: str, _store) -> PageContent | None:
        if url.endswith("/first"):
            await asyncio.sleep(0.01)
            return PageContent(
                url=url,
                title="First",
                text="Speed Org is a housing advocacy organization. Housing content " * 50,
                task_id=task_id,
            )

        await self._provider_started.wait()
        return PageContent(
            url=url,
            title="Second",
            text="Speed Org education programs serve the community. Education content " * 50,
            task_id=task_id,
        )


class _CrawlingFetcher:
    def __init__(self) -> None:
        self.fetched_urls: list[str] = []

    async def fetch_tracked(self, url: str, task_id: str, _store) -> PageContent | None:
        self.fetched_urls.append(url)
        if url.endswith("/seed"):
            return PageContent(
                url=url,
                title="Seed",
                text="Seed content " * 120,
                task_id=task_id,
                discovered_links=["https://example.com/linked"],
            )

        if url.endswith("/linked"):
            return PageContent(
                url=url,
                title="Linked",
                text="Linked content " * 120,
                task_id=task_id,
            )
        return None


class _VerboseSkipFetcher:
    async def fetch_tracked_verbose(self, url: str, task_id: str, _store):
        return {
            "page": None,
            "status": "filtered",
            "error": "blocked_by_robots_txt",
            "discovered_links": [],
            "task_id": task_id,
            "url": url,
        }


class _ThinHubFetcher:
    def __init__(self) -> None:
        self.fetched_urls: list[str] = []

    async def fetch_tracked_verbose(self, url: str, task_id: str, _store):
        self.fetched_urls.append(url)
        if url.endswith("/hub"):
            return {
                "page": None,
                "status": "filtered",
                "error": "content_below_min_words",
                "discovered_links": ["https://example.com/article"],
                "task_id": task_id,
                "url": url,
            }
        if url.endswith("/article"):
            return {
                "page": PageContent(
                    url=url,
                    title="Article",
                    text="Article content " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [],
                "task_id": task_id,
                "url": url,
            }
        return {
            "page": None,
            "status": "filtered",
            "error": "not_found",
            "discovered_links": [],
            "task_id": task_id,
            "url": url,
        }


class _ArticleAndSectionFetcher:
    def __init__(self) -> None:
        self.fetched_urls: list[str] = []

    async def fetch_tracked_verbose(self, url: str, task_id: str, _store):
        self.fetched_urls.append(url)
        if url.endswith("/seed"):
            return {
                "page": PageContent(
                    url=url,
                    title="Seed article",
                    text="Seed article content " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [
                    "https://example.com/news",
                    "https://example.com/news/article/important-story",
                ],
                "task_id": task_id,
                "url": url,
            }
        if url.endswith("/news"):
            return {
                "page": PageContent(
                    url=url,
                    title="News",
                    text="News section summary " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [],
                "task_id": task_id,
                "url": url,
            }
        if url.endswith("/important-story"):
            return {
                "page": PageContent(
                    url=url,
                    title="Important Story",
                    text="Important story content " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [],
                "task_id": task_id,
                "url": url,
            }
        return {
            "page": None,
            "status": "filtered",
            "error": "not_found",
            "discovered_links": [],
            "task_id": task_id,
            "url": url,
        }


class _SectionSubsectionFetcher:
    def __init__(self) -> None:
        self.fetched_urls: list[str] = []

    async def fetch_tracked_verbose(self, url: str, task_id: str, _store):
        self.fetched_urls.append(url)
        if url.endswith("/seed"):
            return {
                "page": PageContent(
                    url=url,
                    title="Seed article",
                    text="Seed article content " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [
                    "https://example.com/sports/colleges/utsa",
                    "https://example.com/statewide-housing-alliance",
                ],
                "task_id": task_id,
                "url": url,
            }
        if url.endswith("/utsa"):
            return {
                "page": PageContent(
                    url=url,
                    title="UTSA Sports",
                    text="Sports section content " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [],
                "task_id": task_id,
                "url": url,
            }
        if url.endswith("/statewide-housing-alliance"):
            return {
                "page": PageContent(
                    url=url,
                    title="Statewide Housing Alliance",
                    text="Housing alliance story " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [],
                "task_id": task_id,
                "url": url,
            }
        return {
            "page": None,
            "status": "filtered",
            "error": "not_found",
            "discovered_links": [],
            "task_id": task_id,
            "url": url,
        }


class _DeepArticleFetcher:
    async def fetch_tracked_verbose(self, url: str, task_id: str, _store):
        if url.endswith("/seed"):
            return {
                "page": PageContent(
                    url=url,
                    title="Seed article",
                    text="Seed article content " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": ["https://example.com/related-housing-story-2026"],
                "task_id": task_id,
                "url": url,
            }
        if url.endswith("/related-housing-story-2026"):
            return {
                "page": PageContent(
                    url=url,
                    title="Related story",
                    text="Related story content " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": ["https://example.com/deeper-housing-story-2026"],
                "task_id": task_id,
                "url": url,
            }
        if url.endswith("/deeper-housing-story-2026"):
            return {
                "page": PageContent(
                    url=url,
                    title="Deeper story",
                    text="Deeper story content " * 120,
                    task_id=task_id,
                ),
                "status": "fetched",
                "error": None,
                "discovered_links": [],
                "task_id": task_id,
                "url": url,
            }
        return {
            "page": None,
            "status": "filtered",
            "error": "not_found",
            "discovered_links": [],
            "task_id": task_id,
            "url": url,
        }
