"""Article frontier expansion behavior."""

from datetime import date

from atlas_scout.articles.frontier_expand import collect_expansion_frontier_items


def test_collect_expansion_items_saves_discovery_articles_before_frontier() -> None:
    article = {
        "url": "https://example.test/2026/07/01/alex-rivera-opens-civic-center",
        "title": "Alex Rivera opens civic center in Dallas",
        "published_at": "2026-07-01T12:00:00+00:00",
        "source_name": "Example Daily",
        "source_domain": "example.test",
        "section": "2026",
        "provider": "crawl",
        "provider_id": "https://example.test/2026/07/01/alex-rivera-opens-civic-center",
        "api_url": None,
        "metadata": {
            "discovery_method": "crawl",
            "extraction_method": "news_sitemap",
            "seed_url": "https://example.test/news-sitemap.xml",
            "mentions": [{"name": "Alex Rivera", "type": "person"}],
        },
    }

    frontier_items, article_records, counters = collect_expansion_frontier_items(
        [
            {
                "url": "https://example.test/news-sitemap.xml",
                "seed_url": "https://example.test/news-sitemap.xml",
                "depth": 0,
            }
        ],
        [
            {
                "discovered_links": [article["url"]],
                "discovery_articles": [article],
            }
        ],
        existing_article_urls=set(),
        discovered_urls=set(),
        from_date=None,
        to_date=None,
        save_articles=True,
    )

    assert article_records == [article]
    assert frontier_items == []
    assert counters["article_records"] == 1


def test_collect_expansion_items_prunes_discovery_articles_by_date() -> None:
    old_article = {
        "url": "https://example.test/2000/01/01/old-story",
        "title": "Old Story",
        "published_at": "2000-01-01T12:00:00+00:00",
    }

    _frontier_items, article_records, counters = collect_expansion_frontier_items(
        [{"url": "https://example.test/news-sitemap.xml", "seed_url": "seed", "depth": 0}],
        [{"discovered_links": [], "discovery_articles": [old_article]}],
        existing_article_urls=set(),
        discovered_urls=set(),
        from_date=date(2006, 7, 6),
        to_date=date(2026, 7, 6),
        save_articles=True,
    )

    assert article_records == []
    assert counters["pruned_by_date"] == 1


def test_collect_expansion_items_saves_dated_discovered_links_as_articles() -> None:
    article_url = "https://example.test/2026/07/01/alex-rivera-opens-civic-center"

    frontier_items, article_records, counters = collect_expansion_frontier_items(
        [{"url": "https://example.test/sitemap/2026/07/01", "seed_url": "seed", "depth": 0}],
        [{"discovered_links": [article_url], "discovery_articles": []}],
        existing_article_urls=set(),
        discovered_urls=set(),
        from_date=date(2006, 7, 6),
        to_date=date(2026, 7, 6),
        save_articles=True,
    )

    assert frontier_items == []
    assert article_records[0]["url"] == article_url
    assert article_records[0]["metadata"]["extraction_method"] == "linked_url"
    assert counters["article_records"] == 1
