"""Tests for sitemap and feed discovery resources."""

from atlas_scout.scraper.discovery_resources import extract_discovery_links


def test_extract_discovery_links_reads_sitemap_index_and_urlset() -> None:
    xml = """\
    <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://news.example.com/sitemaps/2024.xml</loc></sitemap>
      <url><loc>https://news.example.com/2024/05/10/story#comments</loc></url>
    </sitemapindex>
    """

    links = extract_discovery_links(
        xml.encode(),
        url="https://news.example.com/sitemap.xml",
        content_type="application/xml",
    )

    assert links == [
        "https://news.example.com/sitemaps/2024.xml",
        "https://news.example.com/2024/05/10/story",
    ]


def test_extract_discovery_links_reads_rss_and_atom_feeds() -> None:
    rss = """\
    <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
      <channel>
        <item><link>https://news.example.com/local/housing</link></item>
        <item><guid isPermaLink="true">https://news.example.com/local/transit</guid></item>
        <item><atom:link rel="alternate" href="https://news.example.com/local/parks" /></item>
      </channel>
    </rss>
    """

    links = extract_discovery_links(
        rss.encode(),
        url="https://news.example.com/feed",
        content_type="application/rss+xml",
    )

    assert links == [
        "https://news.example.com/local/housing",
        "https://news.example.com/local/transit",
        "https://news.example.com/local/parks",
    ]


def test_extract_discovery_links_reads_robots_sitemaps() -> None:
    robots = """\
    User-agent: *
    Disallow: /account
    Sitemap: https://news.example.com/news-sitemap.xml
    sitemap: /sitemaps/archive-index.xml
    """

    links = extract_discovery_links(
        robots.encode(),
        url="https://news.example.com/robots.txt",
        content_type="text/plain",
    )

    assert links == [
        "https://news.example.com/news-sitemap.xml",
        "https://news.example.com/sitemaps/archive-index.xml",
    ]
