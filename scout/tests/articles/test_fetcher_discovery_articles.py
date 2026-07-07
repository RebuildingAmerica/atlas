"""Fetcher support for article records embedded in discovery resources."""

import httpx
import respx

from atlas_scout.scraper.fetcher import AsyncFetcher


@respx.mock
async def test_fetcher_returns_discovery_articles_from_news_sitemap() -> None:
    body = """
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
            xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
      <url>
        <loc>https://example.test/2026/07/01/alex-rivera-opens-civic-center</loc>
        <news:news>
          <news:publication><news:name>Example Daily</news:name></news:publication>
          <news:publication_date>2026-07-01T12:00:00Z</news:publication_date>
          <news:title>Alex Rivera opens civic center in Dallas</news:title>
        </news:news>
      </url>
    </urlset>
    """
    respx.get("https://example.test/news-sitemap.xml").mock(
        return_value=httpx.Response(
            200,
            text=body,
            headers={"content-type": "application/xml"},
        )
    )
    fetcher = AsyncFetcher(max_concurrent=1, request_delay_ms=0)

    outcome = await fetcher.fetch_tracked_verbose(
        "https://example.test/news-sitemap.xml",
        task_id="",
        _store=None,
    )

    await fetcher.close()
    assert outcome["discovered_links"] == [
        "https://example.test/2026/07/01/alex-rivera-opens-civic-center"
    ]
    assert outcome["discovery_articles"][0]["title"] == "Alex Rivera opens civic center in Dallas"
