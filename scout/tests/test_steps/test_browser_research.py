"""Tests for atlas_scout.steps.browser_research."""

from __future__ import annotations

import json
import sys
from types import ModuleType
from typing import TYPE_CHECKING, Any

from atlas_shared import RawEntry

from atlas_scout.providers.base import Completion, Message
from atlas_scout.steps import browser_research as br

if TYPE_CHECKING:
    import pytest


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


# ----- _parse_url_list -----


def test_parse_url_list_returns_known_urls() -> None:
    valid = {"https://example.com/team", "https://example.com/about"}
    text = json.dumps(["https://example.com/team", "https://other.com/x"])
    result = br._parse_url_list(text, valid)
    assert result == ["https://example.com/team"]


def test_parse_url_list_handles_code_fence() -> None:
    valid = {"https://example.com/team"}
    text = '```json\n["https://example.com/team"]\n```'
    result = br._parse_url_list(text, valid)
    assert result == ["https://example.com/team"]


def test_parse_url_list_handles_think_tag() -> None:
    valid = {"https://example.com/team"}
    text = "<think>reasoning</think>\n" + json.dumps(["https://example.com/team"])
    result = br._parse_url_list(text, valid)
    assert result == ["https://example.com/team"]


def test_parse_url_list_invalid_json_returns_empty() -> None:
    assert br._parse_url_list("{not json", {"https://example.com/x"}) == []


def test_parse_url_list_non_array_returns_empty() -> None:
    text = json.dumps({"a": 1})
    assert br._parse_url_list(text, {"https://example.com/x"}) == []


def test_parse_url_list_filters_non_string_items() -> None:
    valid = {"https://example.com/x"}
    text = json.dumps(["https://example.com/x", 42, None])
    assert br._parse_url_list(text, valid) == ["https://example.com/x"]


# ----- _select_links_with_llm -----


async def test_select_links_with_llm_empty_input() -> None:
    provider = _FakeProvider()
    result = await br._select_links_with_llm([], provider, org_name="Org", max_links=5)
    assert result == []


async def test_select_links_with_llm_dedupes_and_returns_picks() -> None:
    provider = _FakeProvider(completion_text=json.dumps(["https://example.com/team"]))
    links = [
        {"href": "https://example.com/team", "text": "Team"},
        {"href": "https://example.com/team", "text": "duplicate"},
        {"href": "https://example.com/about", "text": "About"},
    ]
    result = await br._select_links_with_llm(links, provider, org_name="Org", max_links=5)
    assert result == ["https://example.com/team"]


async def test_select_links_with_llm_skips_links_without_href() -> None:
    provider = _FakeProvider(completion_text="[]")
    links: list[dict[str, str]] = [{"href": "", "text": "empty"}]
    result = await br._select_links_with_llm(links, provider, org_name="Org", max_links=5)
    assert result == []


async def test_select_links_with_llm_handles_provider_exception() -> None:
    provider = _FakeProvider(raise_exc=RuntimeError("boom"))
    links = [{"href": "https://example.com/team", "text": "Team"}]
    result = await br._select_links_with_llm(links, provider, org_name="", max_links=5)
    assert result == []


# ----- research_org_website -----


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
        self.chromium = self  # ``pw.chromium.launch`` calls our ``launch`` method

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
    monkeypatch: pytest.MonkeyPatch,
    context: _FakePlaywrightContext | None,
    *,
    raise_import_error: bool = False,
) -> None:
    """Inject a fake ``playwright.async_api`` module into ``sys.modules``."""
    # Ensure we always start from a clean state — any previous test may have
    # left a module behind.
    monkeypatch.delitem(sys.modules, "playwright", raising=False)
    monkeypatch.delitem(sys.modules, "playwright.async_api", raising=False)

    if raise_import_error:
        # Leave nothing installed — the import statement raises ImportError.
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


async def test_research_org_website_no_playwright_returns_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_playwright(monkeypatch, None, raise_import_error=True)
    provider = _FakeProvider()
    result = await br.research_org_website(
        "https://example.org",
        provider=provider,
        city="Austin",
        state="TX",
        org_name="ExampleOrg",
    )
    assert result == []


def _patch_extract_page_entries(
    monkeypatch: pytest.MonkeyPatch,
    *,
    by_url: dict[str, list[RawEntry]] | None = None,
    raise_for: set[str] | None = None,
) -> list[str]:
    """Patch the entry extractor used by ``research_org_website``.

    Returns a list that records the URLs the extractor was called with.
    """
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


async def test_research_org_website_full_path_extracts_entries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    long_text = "Body content describing leadership and programs. " * 60
    fake_page = _FakePage(
        links=[
            {"href": "https://example.org/team", "text": "Team"},
            {"href": "https://example.org/programs", "text": "Programs"},
        ],
        page_texts={
            "https://example.org/team": long_text,
            "https://example.org/programs": long_text,
        },
        page_titles={
            "https://example.org/team": "Team Page",
            "https://example.org/programs": "Programs Page",
        },
    )
    fake_browser = _FakeBrowser(fake_page)
    fake_pw = _FakePlaywrightContext(fake_browser)
    _install_fake_playwright(monkeypatch, fake_pw)

    extractor_calls = _patch_extract_page_entries(
        monkeypatch,
        by_url={
            "https://example.org/team": [_entry("Alice", "https://example.org/team")],
            "https://example.org/programs": [],
        },
    )

    provider = _FakeProvider(
        completion_text=json.dumps(["https://example.org/team", "https://example.org/programs"])
    )
    result = await br.research_org_website(
        "https://example.org",
        provider=provider,
        city="Austin",
        state="TX",
        org_name="ExampleOrg",
    )
    assert len(result) == 1
    assert result[0].name == "Alice"
    assert "https://example.org/team" in extractor_calls
    assert fake_browser.closed is True


async def test_research_org_website_skips_low_quality_pages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_page = _FakePage(
        links=[{"href": "https://example.org/thin", "text": "Thin"}],
        page_texts={"https://example.org/thin": "too short"},
    )
    fake_browser = _FakeBrowser(fake_page)
    fake_pw = _FakePlaywrightContext(fake_browser)
    _install_fake_playwright(monkeypatch, fake_pw)

    extractor_calls = _patch_extract_page_entries(monkeypatch)

    provider = _FakeProvider(completion_text=json.dumps(["https://example.org/thin"]))
    result = await br.research_org_website(
        "https://example.org",
        provider=provider,
        city="Austin",
        state="TX",
    )
    assert result == []
    # Extractor was never called because content quality filtered the page.
    assert extractor_calls == []


async def test_research_org_website_continues_when_page_visit_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    long_text = "Body content describing leadership and programs. " * 60
    fake_page = _FakePage(
        links=[
            {"href": "https://example.org/broken", "text": "Broken"},
            {"href": "https://example.org/good", "text": "Good"},
        ],
        page_texts={"https://example.org/good": long_text},
        page_titles={"https://example.org/good": "Good"},
        goto_failures={"https://example.org/broken"},
    )
    fake_browser = _FakeBrowser(fake_page)
    fake_pw = _FakePlaywrightContext(fake_browser)
    _install_fake_playwright(monkeypatch, fake_pw)

    _patch_extract_page_entries(
        monkeypatch,
        by_url={"https://example.org/good": [_entry("Bob", "https://example.org/good")]},
    )
    provider = _FakeProvider(
        completion_text=json.dumps(["https://example.org/broken", "https://example.org/good"])
    )
    result = await br.research_org_website(
        "https://example.org",
        provider=provider,
        city="Austin",
        state="TX",
    )
    assert [e.name for e in result] == ["Bob"]


async def test_research_org_website_top_level_failure_returns_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If launching the browser fails, the outer try/except absorbs the error."""
    fake_page = _FakePage(links=[], page_texts={})
    fake_browser = _FakeBrowser(fake_page)
    fake_pw = _FakePlaywrightContext(fake_browser, launch_raises=True)
    _install_fake_playwright(monkeypatch, fake_pw)

    provider = _FakeProvider()
    result = await br.research_org_website(
        "https://example.org",
        provider=provider,
        city="Austin",
        state="TX",
    )
    assert result == []
