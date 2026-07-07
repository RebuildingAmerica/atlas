"""Article frontier expansion candidate selection."""

from atlas_scout.article_frontier import article_frontier_item
from atlas_scout.store import ScoutStore


async def test_expansion_candidates_can_include_fetched_discovery_resources(
    tmp_db_path: object,
) -> None:
    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    try:
        fetched_url = "https://example.test/news-sitemap.xml"
        pending_url = "https://example.test/robots.txt"
        await store.upsert_article_frontier(
            [
                article_frontier_item(url=fetched_url, seed_url=fetched_url, depth=0),
                article_frontier_item(url=pending_url, seed_url=pending_url, depth=0),
            ]
        )
        await store.mark_article_frontier_fetched([fetched_url])

        default_rows = await store.list_article_frontier_expansion_candidates()
        include_fetched_rows = await store.list_article_frontier_expansion_candidates(
            include_fetched=True
        )

        assert {row["url"] for row in default_rows} == {pending_url}
        assert {row["url"] for row in include_fetched_rows} == {fetched_url, pending_url}
    finally:
        await store.close()
