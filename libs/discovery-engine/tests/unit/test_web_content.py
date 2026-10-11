"""Shared source rules retain readable evidence and deterministic crawl links."""

from dataclasses import dataclass

import pytest

from atlas_discovery_engine import web_content as web


@dataclass
class Metadata:
    title: str | None = None
    sitename: str | None = None
    date: str | None = None


@pytest.mark.parametrize(
    "url,expected",
    [
        ("  ", ""),
        (" https://example.org/#top ", "https://example.org"),
        ("https://example.org/?page=1#top", "https://example.org/?page=1"),
        ("https://example.org/page/", "https://example.org/page/"),
        ("https://example.org/;x", "https://example.org/;x"),
    ],
)
def test_normalization_retains_resource_identity(url, expected):
    assert web.normalize_url(url) == expected


@pytest.mark.parametrize(
    "candidate,expected",
    [
        ("mailto:a@example.org", False),
        ("http://example.org/a", True),
        ("https://example.org:443/a", False),
        ("https://other.org", False),
    ],
)
def test_frontier_matches_scout_exact_http_netloc(candidate, expected):
    assert web.same_domain("https://example.org", candidate) == expected


def test_links_deduplicate_in_order_with_optional_cross_domain():
    html = """<p href="/ignored">Text</p><a name="x" href="">Empty</a>
    <a href="/#top">Root</a><a href="/">Duplicate</a><a href="/path/">Path</a>
    <a href="mailto:hello@example.org">Mail</a><a href="https://other.org/a">Other</a>"""
    assert web.extract_links(html, "https://example.org") == [
        "https://example.org",
        "https://example.org/path/",
    ]
    assert (
        web.extract_links(html, "https://example.org", same_domain=False)[-1]
        == "https://other.org/a"
    )


@pytest.mark.parametrize(
    "html,text,reason",
    [
        (" ", "words " * 50, "empty_body"),
        ("<a href='/people'>People</a>", None, "content_not_extractable"),
        ("<a href='/people'>People</a>", "too short", "content_below_min_words"),
        ("html", "Please sign in " + "words " * 50, "login_or_paywall"),
    ],
)
def test_sparse_and_blocked_pages_retain_links_without_metadata_calls(html, text, reason):
    def metadata(_):
        pytest.fail("Rejected content must not be treated as a readable source")

    result = web.extract_html_content(
        html, "https://example.org", text_reader=lambda _: text, metadata_reader=metadata
    )
    assert result.reason == reason
    assert result.page is None
    assert result.discovered_links == (["https://example.org/people"] if "href" in html else [])
    assert not web.is_quality_content(text or "") or reason == "empty_body"


@pytest.mark.parametrize(
    "metadata",
    [None, Metadata(), Metadata("Article", "Civic News", "2026-01-02"), Metadata(date="invalid")],
)
def test_readable_page_preserves_metadata_and_quality(metadata):
    result = web.extract_html_content(
        '<meta property="og:type" content="article"><a href="/p">People</a>',
        "https://example.org",
        text_reader=lambda _: "words " * 50,
        metadata_reader=lambda _: metadata,
    )
    page = result.page
    assert page.title == (metadata.title or "" if metadata else "")
    assert page.publication == (metadata.sitename if metadata else None)
    assert page.source_type == "news_article"
    assert page.structured_data == {"opengraph": {"type": "article"}}
    assert page.discovered_links == result.discovered_links == ["https://example.org/p"]
    assert (page.published_date is not None) == bool(metadata and metadata.date == "2026-01-02")
    assert web.is_quality_content(page.text)


def test_structured_metadata_keeps_jsonld_objects_lists_and_cards():
    html = """Outside<script type="application/ld+json">{"@type":"Article"}</script>
    <script type="application/ld+json">[{"@type":"Report"}]</script>
    <script type="application/ld+json">invalid</script>
    <script type="application/ld+json">  </script>
    <meta property="og:title" content="Title"><meta name="twitter:card" content="summary">
    <meta name="irrelevant"><p>Unstructured</p>"""
    assert web.extract_structured_data(html) == {
        "jsonld": [{"@type": "Article"}, {"@type": "Report"}],
        "opengraph": {"title": "Title"},
        "twitter_card": {"card": "summary"},
    }
    assert web.extract_structured_data("<p>Plain</p>") == {}


def test_malformed_metadata_does_not_destroy_readable_evidence(monkeypatch):
    def fail(*_):
        raise ValueError("bad publisher HTML")

    monkeypatch.setattr(web._StructuredDataParser, "feed", fail)
    assert web.extract_structured_data("bad") == {}


@pytest.mark.parametrize(
    "url,data,expected",
    [
        ("https://example.org", {"opengraph": {"type": "news"}}, "news_article"),
        ("https://example.org", {"opengraph": {"type": "video"}}, "video"),
        ("https://example.org", {"jsonld": [{"@type": "Article"}]}, "news_article"),
        ("https://example.org", {"jsonld": [{"@type": "VideoObject"}]}, "video"),
        ("https://example.org", {"jsonld": [{"@type": "PodcastEpisode"}]}, "podcast"),
        ("https://example.org", {"jsonld": [{"@type": "Report"}]}, "report"),
        ("https://example.org", {"jsonld": [{"@type": "Person"}]}, "org_website"),
        ("https://sub.x.com", None, "social_media"),
        ("https://youtube.com/watch", None, "video"),
        ("https://council.gov", None, "government_record"),
        ("https://example.org/report", None, "org_website"),
    ],
)
def test_source_type_uses_evidence_not_path_keywords(url, data, expected):
    assert web._infer_source_type(url, data) == expected
