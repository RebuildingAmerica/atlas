"""Helper and PDF coverage for atlas_scout.scraper.fetcher.AsyncFetcher."""

from __future__ import annotations

from datetime import datetime
from typing import Any, ClassVar

import httpx
import pytest  # noqa: TC002
import respx
from atlas_shared import SourceType

from atlas_scout.scraper.fetch_outcome import (
    coerce_discovered_links,
    parse_cached_datetime,
    parse_source_type,
)
from atlas_scout.scraper.fetcher import AsyncFetcher
from atlas_scout.scraper.pdf_extraction import extract_pdf_content


def test_parse_cached_datetime_variants() -> None:
    assert parse_cached_datetime(None) is None
    assert parse_cached_datetime("") is None
    when = datetime(2024, 1, 2, 3, 4, 5)  # noqa: DTZ001
    assert parse_cached_datetime(when) == when
    expected = datetime(2024, 1, 2, 3, 4, 5)  # noqa: DTZ001
    assert parse_cached_datetime("2024-01-02T03:04:05") == expected
    assert parse_cached_datetime("not-a-date") is None
    assert parse_cached_datetime(12345) is None


def test_parse_source_type_variants() -> None:
    assert parse_source_type(SourceType.NEWS_ARTICLE) == SourceType.NEWS_ARTICLE
    assert parse_source_type("website") == SourceType.WEBSITE
    assert parse_source_type("not-a-real-type") == SourceType.WEBSITE
    assert parse_source_type(None) == SourceType.WEBSITE


def test_coerce_discovered_links_variants() -> None:
    assert coerce_discovered_links(["a", "b"]) == ["a", "b"]
    assert coerce_discovered_links(["a", "", None]) == ["a", "None"]
    assert coerce_discovered_links(None) == []
    assert coerce_discovered_links("not a list") == []


@respx.mock
async def test_fetch_pdf_content_type_routes_to_pdf_extractor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    long_text = "PDF document body discussing civic matters. " * 50

    class FakePage:
        def get_text(self) -> str:
            return long_text

    class FakeDoc:
        metadata: ClassVar[dict[str, Any]] = {"title": "PDF Title"}

        def __iter__(self) -> Any:
            return iter([FakePage()])

        def close(self) -> None:
            pass

    fake_module = type("fake", (), {})()
    fake_module.open = lambda **_: FakeDoc()  # type: ignore[attr-defined]
    import sys

    monkeypatch.setitem(sys.modules, "pymupdf", fake_module)
    respx.get("https://example.com/doc.pdf").mock(
        return_value=httpx.Response(
            200,
            content=b"%PDF-1.4 fake bytes",
            headers={"content-type": "application/pdf"},
        )
    )
    fetcher = AsyncFetcher(max_concurrent=5, request_delay_ms=0)
    result = await fetcher.fetch("https://example.com/doc.pdf")
    await fetcher.close()
    assert result is not None
    assert result.text == long_text.strip()


def test_extract_pdf_content_no_pymupdf_returns_unavailable() -> None:
    result = extract_pdf_content(b"data", url="https://example.com/x.pdf")
    assert result.page is None
    assert result.reason == "pdf_extraction_unavailable"


def test_extract_pdf_content_open_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_module = type("fake", (), {})()

    def boom(**_: Any) -> Any:
        raise RuntimeError("bad pdf")

    fake_module.open = boom  # type: ignore[attr-defined]
    import sys

    monkeypatch.setitem(sys.modules, "pymupdf", fake_module)
    result = extract_pdf_content(b"data", url="https://example.com/x.pdf")
    assert result.page is None
    assert result.reason == "pdf_extraction_failed"


def test_extract_pdf_content_text_too_short(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakePage:
        def get_text(self) -> str:
            return "tiny"

    class FakeDoc:
        metadata: ClassVar[dict[str, Any]] = {"title": "Doc"}

        def __iter__(self) -> Any:
            return iter([FakePage()])

        def close(self) -> None:
            pass

    fake_module = type("fake", (), {})()
    fake_module.open = lambda **_: FakeDoc()  # type: ignore[attr-defined]
    import sys

    monkeypatch.setitem(sys.modules, "pymupdf", fake_module)
    result = extract_pdf_content(b"data", url="https://example.com/x.pdf")
    assert result.page is None
    assert result.reason == "content_below_min_words"


def test_extract_pdf_content_empty_text(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakePage:
        def get_text(self) -> str:
            return ""

    class FakeDoc:
        metadata: ClassVar[dict[str, Any]] = {"title": ""}

        def __iter__(self) -> Any:
            return iter([FakePage()])

        def close(self) -> None:
            pass

    fake_module = type("fake", (), {})()
    fake_module.open = lambda **_: FakeDoc()  # type: ignore[attr-defined]
    import sys

    monkeypatch.setitem(sys.modules, "pymupdf", fake_module)
    result = extract_pdf_content(b"data", url="https://example.com/x.pdf")
    assert result.page is None
    assert result.reason == "content_below_min_words"


def test_extract_pdf_content_success(monkeypatch: pytest.MonkeyPatch) -> None:
    long_text = "Substantial PDF body discussing public policy. " * 60

    class FakePage:
        def get_text(self) -> str:
            return long_text

    class FakeDoc:
        metadata: ClassVar[dict[str, Any]] = {"title": "Annual Report"}

        def __iter__(self) -> Any:
            return iter([FakePage()])

        def close(self) -> None:
            pass

    fake_module = type("fake", (), {})()
    fake_module.open = lambda **_: FakeDoc()  # type: ignore[attr-defined]
    import sys

    monkeypatch.setitem(sys.modules, "pymupdf", fake_module)
    result = extract_pdf_content(b"data", url="https://example.com/x.pdf")
    assert result.page is not None
    assert result.page.title == "Annual Report"
    assert result.page.source_type == SourceType.REPORT


def test_extract_pdf_content_missing_title_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    long_text = "Substantial PDF body discussing public policy. " * 60

    class FakePage:
        def get_text(self) -> str:
            return long_text

    class FakeDoc:
        metadata: ClassVar[dict[str, Any]] = {}

        def __iter__(self) -> Any:
            return iter([FakePage()])

        def close(self) -> None:
            pass

    fake_module = type("fake", (), {})()
    fake_module.open = lambda **_: FakeDoc()  # type: ignore[attr-defined]
    import sys

    monkeypatch.setitem(sys.modules, "pymupdf", fake_module)
    result = extract_pdf_content(b"data", url="https://example.com/x.pdf")
    assert result.page is not None
    assert result.page.title == ""
