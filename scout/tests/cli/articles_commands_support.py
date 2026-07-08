"""Shared helpers for Scout article CLI tests."""

from __future__ import annotations

import textwrap
from typing import TYPE_CHECKING

from atlas_scout.store import ScoutStore

if TYPE_CHECKING:
    from pathlib import Path


def _write_config(tmp_path: Path) -> Path:
    config_path = tmp_path / "scout.toml"
    db_path = tmp_path / "scout.db"
    config_path.write_text(
        textwrap.dedent(
            f"""\
            [store]
            path = "{db_path}"
            """
        )
    )
    return config_path


def _article_html(title: str, body_text: str, *, published_at: str) -> str:
    return (
        "<html><head>"
        '<meta property="og:type" content="article">'
        f'<meta property="og:title" content="{title}">'
        '<meta property="og:site_name" content="Example News">'
        '<script type="application/ld+json">'
        f'{{"@type":"NewsArticle","headline":"{title}",'
        f'"datePublished":"{published_at}","publisher":{{"name":"Example News"}}}}'
        "</script>"
        "</head><body>"
        f"<article><h1>{title}</h1><p>{body_text}</p></article>"
        "</body></html>"
    )


async def _seed_article_with_stale_mentions(db_path: Path) -> None:
    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        await store.bulk_save_articles(
            [
                {
                    "url": "https://www.theguardian.com/us-news/2026/jul/05/current",
                    "title": "Joe Biden met Donald Trump in New York",
                    "published_at": "2026-07-05T12:00:00Z",
                    "source_name": "The Guardian",
                    "source_domain": "www.theguardian.com",
                    "section": "US news",
                    "provider": "guardian",
                    "provider_id": "us-news/2026/jul/05/current",
                    "api_url": "https://content.guardianapis.com/us-news/2026/jul/05/current",
                    "metadata": {
                        "trail_text": "Joe Biden spoke to CNN after the Senate vote.",
                        "body_text_excerpt": "Donald Trump responded from New York.",
                        "guardian_tags": [
                            {
                                "id": "us-news/joebiden",
                                "type": "keyword",
                                "title": "Joe Biden",
                            }
                        ],
                        "mentions": [
                            {
                                "name": "Joe Biden",
                                "type": "keyword",
                                "source": "guardian_tag",
                            }
                        ],
                    },
                }
            ]
        )
    finally:
        await store.close()


async def _seed_utility_article(db_path: Path) -> None:
    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        await store.bulk_save_articles(
            [
                {
                    "url": "https://www.nydailynews.com/contact-us",
                    "title": "Contact Us",
                    "published_at": "2023-07-19T00:00:00Z",
                    "source_name": "New York Daily News",
                    "source_domain": "www.nydailynews.com",
                    "section": "contact-us",
                    "provider": "crawl",
                    "provider_id": "https://www.nydailynews.com/contact-us",
                    "api_url": None,
                    "metadata": {
                        "discovery_method": "crawl",
                        "seed_url": "https://www.nydailynews.com/sitemap.xml",
                        "crawl_depth": 2,
                        "source_type": "news_article",
                        "publication": "New York Daily News",
                        "body_text_length": 1200,
                        "body_text_excerpt": "Contact Us CUSTOMER SERVICE " * 20,
                        "schema_types": ["WebPage", "BreadcrumbList"],
                        "opengraph_type": "article",
                        "mentions": [
                            {"name": "New York Daily News", "type": "text", "source": "body_text"}
                        ],
                    },
                }
            ]
        )
    finally:
        await store.close()


async def _seed_articles_across_date_window(db_path: Path) -> None:
    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        await store.bulk_save_articles(
            [
                {
                    "url": "https://example-news.test/2001/05/01/stale-story",
                    "title": "Stale story names Civic Leader",
                    "published_at": "2001-05-01T12:00:00Z",
                    "source_name": "Example News",
                    "source_domain": "example-news.test",
                    "section": "archive",
                    "provider": "crawl",
                    "provider_id": "https://example-news.test/2001/05/01/stale-story",
                    "api_url": None,
                    "metadata": {
                        "discovery_method": "crawl",
                        "seed_url": "https://example-news.test/sitemap.xml",
                        "crawl_depth": 2,
                        "source_type": "news_article",
                        "publication": "Example News",
                        "body_text_length": 1200,
                        "body_text_excerpt": "Civic Leader organized a neighborhood project. " * 20,
                        "schema_types": ["NewsArticle"],
                        "opengraph_type": "article",
                        "mentions": [
                            {
                                "name": "Civic Leader",
                                "type": "text",
                                "source": "body_text",
                            }
                        ],
                    },
                },
                {
                    "url": "https://example-news.test/2026/07/05/current-story",
                    "title": "Current story names Civic Partner",
                    "published_at": "2026-07-05T12:00:00Z",
                    "source_name": "Example News",
                    "source_domain": "example-news.test",
                    "section": "news",
                    "provider": "crawl",
                    "provider_id": "https://example-news.test/2026/07/05/current-story",
                    "api_url": None,
                    "metadata": {
                        "discovery_method": "crawl",
                        "seed_url": "https://example-news.test/sitemap.xml",
                        "crawl_depth": 2,
                        "source_type": "news_article",
                        "publication": "Example News",
                        "body_text_length": 1200,
                        "body_text_excerpt": "Civic Partner organized a housing project. " * 20,
                        "schema_types": ["NewsArticle"],
                        "opengraph_type": "article",
                        "mentions": [
                            {
                                "name": "Civic Partner",
                                "type": "text",
                                "source": "body_text",
                            }
                        ],
                    },
                },
            ]
        )
    finally:
        await store.close()


async def _seed_existing_crawl_article(db_path: Path, article_url: str) -> None:
    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        await store.bulk_save_articles(
            [
                {
                    "url": article_url,
                    "title": "Existing article names Civic Leader",
                    "published_at": "2024-05-10T12:00:00Z",
                    "source_name": "Example News",
                    "source_domain": "example-news.test",
                    "section": "news",
                    "provider": "crawl",
                    "provider_id": article_url,
                    "api_url": None,
                    "metadata": {
                        "discovery_method": "crawl",
                        "seed_url": "https://example-news.test/sitemap.xml",
                        "crawl_depth": 1,
                        "source_type": "news_article",
                        "publication": "Example News",
                        "body_text_length": 1200,
                        "body_text_excerpt": "Civic Leader organized a public project. " * 20,
                        "schema_types": ["NewsArticle"],
                        "opengraph_type": "article",
                        "mentions": [
                            {
                                "name": "Civic Leader",
                                "type": "text",
                                "source": "body_text",
                            }
                        ],
                    },
                }
            ]
        )
    finally:
        await store.close()
