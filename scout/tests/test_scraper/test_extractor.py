"""Tests for atlas_scout.scraper.extractor."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from atlas_shared import SourceType

if TYPE_CHECKING:
    import pytest

from atlas_scout.scraper import extractor
from atlas_scout.scraper.extractor import (
    ContentExtraction,
    _infer_source_type,
    _parse_metadata_datetime,
    _StructuredDataParser,
    content_quality_reason,
    extract_content,
    extract_content_verbose,
    extract_structured_content,
    extract_structured_data,
    is_quality_content,
)


def test_extract_content_from_html() -> None:
    html = (
        "<html><body><article><p>"
        + "housing policy debate in Austin Texas. " * 40
        + "</p></article></body></html>"
    )
    result = extract_content(html, url="https://example.com/article")
    assert result is not None
    assert "housing" in result.text.lower()


def test_extract_content_returns_none_for_empty() -> None:
    assert extract_content("", url="https://example.com") is None


def test_is_quality_content_passes_good_text() -> None:
    assert is_quality_content(" ".join(["word"] * 250)) is True


def test_is_quality_content_rejects_short_text() -> None:
    assert is_quality_content("Too short.") is False


def test_is_quality_content_rejects_login_wall() -> None:
    assert (
        is_quality_content(
            "Please log in to continue reading this article. Sign up for a free account."
        )
        is False
    )


def test_extract_content_verbose_empty_body_reason() -> None:
    result = extract_content_verbose("   ", url="https://example.com")
    assert result.page is None
    assert result.reason == "empty_body"
    assert result.discovered_links == []


def test_extract_content_verbose_trafilatura_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(extractor.trafilatura, "extract", lambda _html, **_: None)
    html = "<html><body><p>x</p></body></html>"
    result = extract_content_verbose(html, url="https://example.com")
    assert result.page is None
    assert result.reason == "content_not_extractable"


def test_extract_content_verbose_quality_filter(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(extractor.trafilatura, "extract", lambda _html, **_: "too short")
    html = "<html><body><p>x</p></body></html>"
    result = extract_content_verbose(html, url="https://example.com")
    assert result.page is None
    assert result.reason == "content_below_min_words"


def test_extract_content_verbose_login_wall_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        extractor.trafilatura,
        "extract",
        lambda _html, **_: "Please log in to read this. " + ("filler word " * 80),
    )
    html = "<html><body><p>x</p></body></html>"
    result = extract_content_verbose(html, url="https://example.com")
    assert result.page is None
    assert result.reason == "login_or_paywall"


def test_extract_content_verbose_uses_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    long_text = "Rich article body about civic infrastructure. " * 50
    monkeypatch.setattr(extractor.trafilatura, "extract", lambda _html, **_: long_text)

    class FakeMetadata:
        title = "My Title"
        sitename = "Atlas Times"
        date = "2024-05-06"

    monkeypatch.setattr(extractor.trafilatura, "extract_metadata", lambda _html: FakeMetadata())
    html = "<html><body><p>x</p></body></html>"
    result = extract_content_verbose(html, url="https://example.com/article")
    assert result.page is not None
    assert result.page.title == "My Title"
    assert result.page.publication == "Atlas Times"
    assert result.page.published_date == datetime(2024, 5, 6)  # noqa: DTZ001 — naive parser output
    assert result.reason is None


def test_extract_content_verbose_no_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    long_text = "Rich article body about civic infrastructure. " * 50
    monkeypatch.setattr(extractor.trafilatura, "extract", lambda _html, **_: long_text)
    monkeypatch.setattr(extractor.trafilatura, "extract_metadata", lambda _html: None)
    html = "<html><body><p>x</p></body></html>"
    result = extract_content_verbose(html, url="https://example.com/article")
    assert result.page is not None
    assert result.page.title == ""
    assert result.page.publication is None
    assert result.page.published_date is None


def test_extract_content_verbose_metadata_missing_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    long_text = "Rich article body about civic infrastructure. " * 50
    monkeypatch.setattr(extractor.trafilatura, "extract", lambda _html, **_: long_text)

    class FakeMetadata:
        title = ""
        sitename = ""
        date = None

    monkeypatch.setattr(extractor.trafilatura, "extract_metadata", lambda _html: FakeMetadata())
    html = "<html><body><p>x</p></body></html>"
    result = extract_content_verbose(html, url="https://example.com/article")
    assert result.page is not None
    assert result.page.title == ""
    assert result.page.publication is None
    assert result.page.published_date is None


def test_extract_structured_content_accepts_csv_resource() -> None:
    body = (
        b"name,office,office_state,election_year\n"
        b"Jane Doe,Mayor,CA,2026\n"
        b"John Smith,Council,TX,2026\n"
    )

    result = extract_structured_content(
        body,
        url="https://example.gov/people.csv",
        content_type="text/csv",
    )

    assert result is not None
    assert result.reason is None
    assert result.page is not None
    assert result.page.text.startswith("name,office")
    assert result.page.title == "people.csv"
    assert result.page.structured_data["resource_format"] == "csv"


def test_extract_structured_content_reads_delimited_zip_member() -> None:
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("readme.txt", "not structured")
        archive.writestr("people.txt", "Jane Doe|Mayor|CA\nJohn Smith|Council|TX\n")

    result = extract_structured_content(
        buffer.getvalue(),
        url="https://example.gov/people.zip",
        content_type="application/zip",
    )

    assert result is not None
    assert result.reason is None
    assert result.page is not None
    assert "Jane Doe|Mayor|CA" in result.page.text
    assert result.page.title == "people.txt"
    assert result.page.structured_data["resource_format"] == "zip"
    assert result.page.structured_data["archive_member"] == "people.txt"


def test_content_quality_reason_login_pattern() -> None:
    text = "Please log in to read this. " + ("filler word " * 80)
    assert content_quality_reason(text) == "login_or_paywall"


def test_extract_structured_data_jsonld_object() -> None:
    html = (
        "<html><head>"
        '<script type="application/ld+json">'
        '{"@type": "NewsArticle", "headline": "Hello"}'
        "</script>"
        "</head></html>"
    )
    structured = extract_structured_data(html)
    assert structured["jsonld"] == [{"@type": "NewsArticle", "headline": "Hello"}]


def test_extract_structured_data_jsonld_array() -> None:
    html = (
        "<html><head>"
        '<script type="application/ld+json">'
        '[{"@type": "Article"}, {"@type": "Person"}]'
        "</script>"
        "</head></html>"
    )
    structured = extract_structured_data(html)
    assert structured["jsonld"] == [{"@type": "Article"}, {"@type": "Person"}]


def test_extract_structured_data_jsonld_invalid_json_ignored() -> None:
    html = '<html><head><script type="application/ld+json">{not json</script></head></html>'
    structured = extract_structured_data(html)
    assert structured == {}


def test_extract_structured_data_jsonld_empty_block_ignored() -> None:
    html = '<html><head><script type="application/ld+json">   </script></head></html>'
    structured = extract_structured_data(html)
    assert structured == {}


def test_extract_structured_data_opengraph_and_twitter() -> None:
    html = (
        "<html><head>"
        '<meta property="og:type" content="article">'
        '<meta property="og:title" content="Headline">'
        '<meta name="twitter:card" content="summary">'
        "</head></html>"
    )
    structured = extract_structured_data(html)
    assert structured["opengraph"] == {"type": "article", "title": "Headline"}
    assert structured["twitter_card"] == {"card": "summary"}


def test_extract_structured_data_handles_parser_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def boom(_self: _StructuredDataParser, _html: str) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(_StructuredDataParser, "feed", boom)
    assert extract_structured_data("<html></html>") == {}


def test_structured_data_parser_handle_data_outside_jsonld_is_noop() -> None:
    parser = _StructuredDataParser()
    parser.handle_data("ignored")
    assert parser.jsonld == []


def test_structured_data_parser_meta_without_relevant_attrs_ignored() -> None:
    parser = _StructuredDataParser()
    parser.handle_starttag("meta", [("property", "robots"), ("content", "noindex")])
    parser.handle_starttag("meta", [("name", "description"), ("content", "ignore")])
    assert parser.opengraph == {}
    assert parser.twitter_card == {}


def test_structured_data_parser_endtag_for_other_tags_noop() -> None:
    parser = _StructuredDataParser()
    parser.handle_endtag("script")  # not in jsonld block — noop
    parser.handle_endtag("div")
    assert parser.jsonld == []


def test_infer_source_type_og_article() -> None:
    structured: dict[str, Any] = {"opengraph": {"type": "article"}}
    assert _infer_source_type("https://news.example.com/x", structured) == SourceType.NEWS_ARTICLE


def test_infer_source_type_og_news() -> None:
    structured: dict[str, Any] = {"opengraph": {"type": "news"}}
    assert _infer_source_type("https://news.example.com/x", structured) == SourceType.NEWS_ARTICLE


def test_infer_source_type_og_video() -> None:
    structured: dict[str, Any] = {"opengraph": {"type": "video"}}
    assert _infer_source_type("https://example.com/clip", structured) == SourceType.VIDEO


def test_infer_source_type_jsonld_article() -> None:
    structured: dict[str, Any] = {"jsonld": [{"@type": "NewsArticle"}]}
    assert _infer_source_type("https://example.com/x", structured) == SourceType.NEWS_ARTICLE


def test_infer_source_type_jsonld_video_object() -> None:
    structured: dict[str, Any] = {"jsonld": [{"@type": "VideoObject"}]}
    assert _infer_source_type("https://example.com/x", structured) == SourceType.VIDEO


def test_infer_source_type_jsonld_podcast() -> None:
    structured: dict[str, Any] = {"jsonld": [{"@type": "PodcastEpisode"}]}
    assert _infer_source_type("https://example.com/x", structured) == SourceType.PODCAST


def test_infer_source_type_jsonld_report() -> None:
    structured: dict[str, Any] = {"jsonld": [{"@type": "Report"}]}
    assert _infer_source_type("https://example.com/x", structured) == SourceType.REPORT


def test_infer_source_type_jsonld_unrecognized_falls_through() -> None:
    structured: dict[str, Any] = {"jsonld": [{"@type": "WebPage"}]}
    assert _infer_source_type("https://example.com/x", structured) == SourceType.WEBSITE


def test_infer_source_type_social_domain() -> None:
    assert _infer_source_type("https://twitter.com/handle") == SourceType.SOCIAL_MEDIA
    assert _infer_source_type("https://www.facebook.com/page") == SourceType.SOCIAL_MEDIA


def test_infer_source_type_video_domain() -> None:
    assert _infer_source_type("https://www.youtube.com/watch?v=x") == SourceType.VIDEO


def test_infer_source_type_government_tld() -> None:
    assert _infer_source_type("https://nasa.gov/about") == SourceType.GOVERNMENT_RECORD


def test_infer_source_type_default_website() -> None:
    assert _infer_source_type("https://example.com/x") == SourceType.WEBSITE


def test_infer_source_type_no_structured_data_argument_default() -> None:
    # ``structured_data`` defaults to ``None``; covers the early branch.
    assert _infer_source_type("https://example.com/x") == SourceType.WEBSITE


def test_parse_metadata_datetime_none() -> None:
    assert _parse_metadata_datetime(None) is None
    assert _parse_metadata_datetime("") is None


def test_parse_metadata_datetime_valid() -> None:
    assert _parse_metadata_datetime("2024-01-02T03:04:05") == datetime(2024, 1, 2, 3, 4, 5)  # noqa: DTZ001


def test_parse_metadata_datetime_invalid_returns_none() -> None:
    assert _parse_metadata_datetime("not-a-date") is None


def test_content_extraction_dataclass_roundtrip() -> None:
    extraction = ContentExtraction(page=None, reason="x", discovered_links=["a"])
    assert extraction.reason == "x"
    assert extraction.discovered_links == ["a"]
