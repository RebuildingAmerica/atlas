"""Article frontier URL heuristics."""

from atlas_scout.article_frontier import article_crawl_is_discovery_resource


def test_path_style_sitemap_urls_are_discovery_resources() -> None:
    assert article_crawl_is_discovery_resource("https://example.test/sitemap/2026/07/6")
