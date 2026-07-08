"""Shared browser research test helpers."""

from __future__ import annotations

import json
import sys
from types import ModuleType
from typing import Any

from atlas_shared import RawEntry

from atlas_scout.providers.base import Completion, Message


class _FakeProvider:
    """Stand-in LLM provider that returns canned completions."""

    def __init__(self, completion_text: str = "[]", raise_exc: Exception | None = None) -> None:
        self._completion_text = completion_text
        self._raise = raise_exc
        self.calls: list[list[Message]] = []

    @property
    def max_concurrent(self) -> int:
        return 1

    async def complete(
        self,
        messages: list[Message],
        _response_schema: object | None = None,
    ) -> Completion:
        self.calls.append(messages)
        if self._raise is not None:
            raise self._raise
        return Completion(text=self._completion_text)


class _FakeBrowser:
    def __init__(self, page: object, *, close_raises: bool = False) -> None:
        self._page = page
        self.close_raises = close_raises
        self.closed = False

    async def new_page(self) -> object:
        return self._page

    async def close(self) -> None:
        self.closed = True
        if self.close_raises:
            raise RuntimeError("close failed")


class _FakePage:
    def __init__(
        self,
        *,
        links: list[dict[str, str]],
        page_texts: dict[str, str],
        page_titles: dict[str, str] | None = None,
        goto_failures: set[str] | None = None,
    ) -> None:
        self._links = links
        self._page_texts = page_texts
        self._page_titles = page_titles or {}
        self._goto_failures = goto_failures or set()
        self._current_url = ""
        self.headers_set: dict[str, str] = {}
        self.visits: list[str] = []

    async def set_extra_http_headers(self, headers: dict[str, str]) -> None:
        self.headers_set = headers

    async def goto(self, url: str, *, wait_until: str, timeout: int) -> None:
        del wait_until, timeout
        self._current_url = url
        self.visits.append(url)
        if url in self._goto_failures:
            raise RuntimeError(f"goto failed: {url}")

    async def evaluate(self, script: str) -> Any:
        if "document.querySelectorAll" in script:
            return self._links
        if "document.body" in script:
            return self._page_texts.get(self._current_url, "")
        raise AssertionError(f"Unexpected script: {script}")

    async def title(self) -> str:
        return self._page_titles.get(self._current_url, "")


class _FakePlaywrightContext:
    """Async context manager mimicking ``async_playwright()``."""

    def __init__(self, browser: _FakeBrowser, *, launch_raises: bool = False) -> None:
        self._browser = browser
        self._launch_raises = launch_raises
        self.chromium = self

    async def __aenter__(self) -> _FakePlaywrightContext:
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None

    async def launch(self, *, headless: bool) -> _FakeBrowser:
        del headless
        if self._launch_raises:
            raise RuntimeError("launch failed")
        return self._browser


def _install_fake_playwright(
    monkeypatch: object,
    context: _FakePlaywrightContext | None,
    *,
    raise_import_error: bool = False,
) -> None:
    """Inject a fake ``playwright.async_api`` module into ``sys.modules``."""
    monkeypatch.delitem(sys.modules, "playwright", raising=False)
    monkeypatch.delitem(sys.modules, "playwright.async_api", raising=False)

    if raise_import_error:
        return

    package = ModuleType("playwright")
    submodule = ModuleType("playwright.async_api")

    def async_playwright() -> _FakePlaywrightContext:
        assert context is not None
        return context

    submodule.async_playwright = async_playwright  # type: ignore[attr-defined]
    package.async_api = submodule  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "playwright", package)
    monkeypatch.setitem(sys.modules, "playwright.async_api", submodule)


def _patch_extract_page_entries(
    monkeypatch: object,
    *,
    by_url: dict[str, list[RawEntry]] | None = None,
    raise_for: set[str] | None = None,
) -> list[str]:
    """Patch the entry extractor used by ``research_org_website``."""
    by_url = by_url or {}
    raise_for = raise_for or set()
    called: list[str] = []

    async def fake_extract(
        page: Any,
        provider: Any,
        city: str,
        state: str,
        *,
        store: Any,
        run_id: Any,
        reuse_cached_extractions: bool,
    ) -> list[RawEntry]:
        del provider, city, state, store, run_id, reuse_cached_extractions
        called.append(page.url)
        if page.url in raise_for:
            raise RuntimeError(f"extractor failed: {page.url}")
        return by_url.get(page.url, [])

    import atlas_scout.steps.entry_extract as ee

    monkeypatch.setattr(ee, "extract_page_entries", fake_extract)
    return called


def _entry(name: str, url: str) -> RawEntry:
    from atlas_shared.types import EntityType

    return RawEntry(
        name=name,
        entry_type=EntityType.ORGANIZATION,
        source_url=url,
    )
