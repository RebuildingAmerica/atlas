"""Tests for atlas_scout.scraper.crawler."""

from atlas_scout.scraper.crawler import extract_links


def test_extract_links_from_html():
    html = (
        "<html><body>"
        '<a href="https://example.com/page1">P1</a>'
        '<a href="https://example.com/page2">P2</a>'
        '<a href="/relative">Rel</a>'
        "</body></html>"
    )
    links = extract_links(html, base_url="https://example.com/start")
    assert "https://example.com/page1" in links
    assert "https://example.com/page2" in links
    assert "https://example.com/relative" in links


def test_extract_links_filters_non_http():
    html = (
        "<html><body>"
        '<a href="mailto:test@x.com">E</a>'
        '<a href="javascript:void(0)">J</a>'
        '<a href="https://example.com/real">R</a>'
        "</body></html>"
    )
    links = extract_links(html, base_url="https://example.com")
    assert len(links) == 1


def test_extract_links_same_domain_only():
    html = (
        "<html><body>"
        '<a href="https://example.com/internal">I</a>'
        '<a href="https://other.com/external">E</a>'
        "</body></html>"
    )
    links = extract_links(html, base_url="https://example.com", same_domain=True)
    assert "https://example.com/internal" in links
    assert "https://other.com/external" not in links
