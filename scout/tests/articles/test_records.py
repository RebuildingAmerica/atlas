"""Tests for article record normalization."""

from datetime import UTC, datetime

from atlas_shared import PageContent, SourceType

from atlas_scout.articles.records import crawled_article_from_page


def test_crawled_article_from_page_rejects_utility_pages_marked_as_articles() -> None:
    page = PageContent(
        url="https://www.nydailynews.com/contact-us/?utm_source=footer",
        title="Contact Us",
        text=(
            "Contact Us CUSTOMER SERVICE Questions comments or problems with the site. "
            "Letters to the editor should include your full name and phone number. "
        )
        * 40,
        published_date=datetime(2023, 7, 19, tzinfo=UTC),
        source_type=SourceType.NEWS_ARTICLE,
        structured_data={
            "opengraph": {"type": "article"},
            "jsonld": [{"@type": "WebPage"}, {"@type": "BreadcrumbList"}],
        },
    )

    article = crawled_article_from_page(
        page,
        seed_url="https://www.nydailynews.com/sitemap.xml",
        crawl_depth=2,
        from_date=None,
        to_date=None,
    )

    assert article is None
