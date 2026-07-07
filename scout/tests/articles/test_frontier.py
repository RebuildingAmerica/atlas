"""Tests for article crawl frontier helpers."""

from atlas_scout.article_frontier import (
    article_frontier_priority,
    source_seed_frontier_priority,
)


def test_article_frontier_priority_prefers_likely_articles_over_index_pages() -> None:
    """Resume crawls should spend pending frontier work on URLs likely to be articles."""
    dated_article = "https://news.test/2024/05/10/city-council-approves-housing-plan"
    slug_article = "https://news.test/news/city-council-approves-housing-plan"
    topic_page = "https://www.wsj.com/news/types/masterpiece"
    author_page = "https://news.test/author/jane-reporter"
    discovery_resource = "https://news.test/sitemap.xml"

    assert article_frontier_priority(dated_article) > article_frontier_priority(slug_article)
    assert article_frontier_priority(slug_article) > article_frontier_priority(topic_page)
    assert article_frontier_priority(topic_page) == article_frontier_priority(author_page)
    assert article_frontier_priority(topic_page) > article_frontier_priority(discovery_resource)


def test_source_seed_frontier_priority_keeps_source_discovery_ahead_of_deep_sitemaps() -> None:
    """Persisted source seeds should not starve behind old sitemap backlog."""
    seed_sitemap = "https://new-source.test/sitemap.xml"
    old_daily_sitemap = "https://known-source.test/sitemap.xml?yyyy=2026&mm=07&dd=06"
    article_url = "https://known-source.test/2026/07/06/city-council-vote"

    assert source_seed_frontier_priority(seed_sitemap) > article_frontier_priority(
        old_daily_sitemap
    )
    assert article_frontier_priority(article_url) > source_seed_frontier_priority(seed_sitemap)
