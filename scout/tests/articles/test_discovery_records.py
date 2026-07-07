"""Article records extracted from news discovery resources."""

import importlib
from datetime import date


def test_news_sitemap_entry_becomes_source_backed_article() -> None:
    discovery_records = importlib.import_module("atlas_scout.article_discovery_records")
    body = b"""
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
            xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
      <url>
        <loc>https://example.test/2026/07/01/alex-rivera-opens-civic-center</loc>
        <news:news>
          <news:publication>
            <news:name>Example Daily</news:name>
            <news:language>en</news:language>
          </news:publication>
          <news:publication_date>2026-07-01T12:00:00Z</news:publication_date>
          <news:title>Alex Rivera opens civic center in Dallas</news:title>
          <news:keywords>Dallas, civic center, Alex Rivera</news:keywords>
        </news:news>
      </url>
    </urlset>
    """

    articles = discovery_records.discovery_articles_from_resource(
        body,
        url="https://example.test/news-sitemap.xml",
        content_type="application/xml",
        from_date=date(2006, 7, 6),
        to_date=date(2026, 7, 6),
    )

    assert len(articles) == 1
    article = articles[0]
    assert article["url"] == "https://example.test/2026/07/01/alex-rivera-opens-civic-center"
    assert article["title"] == "Alex Rivera opens civic center in Dallas"
    assert article["published_at"] == "2026-07-01T12:00:00+00:00"
    assert article["source_name"] == "Example Daily"
    assert article["source_domain"] == "example.test"
    assert article["provider"] == "crawl"
    assert article["metadata"]["discovery_method"] == "crawl"
    assert article["metadata"]["extraction_method"] == "news_sitemap"
    assert article["metadata"]["seed_url"] == "https://example.test/news-sitemap.xml"
    assert article["metadata"]["mentions"]


def test_news_sitemap_entry_without_mentions_is_skipped() -> None:
    discovery_records = importlib.import_module("atlas_scout.article_discovery_records")
    body = b"""
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
            xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
      <url>
        <loc>https://example.test/2026/07/01/local-update</loc>
        <news:news>
          <news:publication><news:name>Example Daily</news:name></news:publication>
          <news:publication_date>2026-07-01T12:00:00Z</news:publication_date>
          <news:title>local update</news:title>
        </news:news>
      </url>
    </urlset>
    """

    articles = discovery_records.discovery_articles_from_resource(
        body,
        url="https://example.test/news-sitemap.xml",
        content_type="application/xml",
        from_date=date(2006, 7, 6),
        to_date=date(2026, 7, 6),
    )

    assert articles == []


def test_regular_sitemap_article_url_becomes_url_derived_article() -> None:
    discovery_records = importlib.import_module("atlas_scout.article_discovery_records")
    body = b"""
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url>
        <loc>https://example.test/2026/07/01/alex-rivera-opens-civic-center</loc>
        <lastmod>2026-07-02T01:00:00Z</lastmod>
      </url>
    </urlset>
    """

    articles = discovery_records.discovery_articles_from_resource(
        body,
        url="https://example.test/sitemap/2026/07/01",
        content_type="application/xml",
        from_date=date(2006, 7, 6),
        to_date=date(2026, 7, 6),
    )

    assert len(articles) == 1
    article = articles[0]
    assert article["title"] == "Alex Rivera Opens Civic Center"
    assert article["published_at"] == "2026-07-01T00:00:00+00:00"
    assert article["metadata"]["extraction_method"] == "sitemap_url"
    assert article["metadata"]["confidence"] == "url_derived"
    assert article["metadata"]["mentions"]
