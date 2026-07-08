"""Article extraction coverage for atlas_scout.store.ScoutStore."""

from __future__ import annotations

import asyncio

from atlas_scout.store import ScoutStore


async def test_claim_article_extraction_batch_skips_completed_articles(
    store: ScoutStore,
) -> None:
    """Completed article extractions are not claimed again for the same prompt."""
    await store.bulk_save_articles(
        [
            {
                "url": "https://news.example/first",
                "title": "First Article",
                "published_at": "2026-07-01T10:00:00+00:00",
                "source_name": "Example News",
                "source_domain": "news.example",
                "section": "local",
                "provider": "crawl",
                "provider_id": "https://news.example/first",
                "api_url": None,
                "metadata": {
                    "body_text_excerpt": "Alice Adams spoke at the public meeting.",
                },
            },
            {
                "url": "https://news.example/second",
                "title": "Second Article",
                "published_at": "2026-07-02T10:00:00+00:00",
                "source_name": "Example News",
                "source_domain": "news.example",
                "section": "local",
                "provider": "crawl",
                "provider_id": "https://news.example/second",
                "api_url": None,
                "metadata": {
                    "body_text_excerpt": "Brianna Brown spoke at the public meeting.",
                },
            },
        ]
    )

    first_claim = await store.claim_article_extraction_batch(
        owner_run_id="run-1",
        provider_key="provider",
        prompt_key="prompt",
        limit=1,
    )
    assert [row["url"] for row in first_claim] == ["https://news.example/second"]
    assert first_claim[0]["metadata"] == {
        "body_text_excerpt": "Brianna Brown spoke at the public meeting.",
    }

    await store.complete_article_extraction(
        article_url="https://news.example/second",
        provider_key="provider",
        prompt_key="prompt",
        entries_extracted=1,
    )

    second_claim = await store.claim_article_extraction_batch(
        owner_run_id="run-2",
        provider_key="provider",
        prompt_key="prompt",
        limit=10,
    )

    assert [row["url"] for row in second_claim] == ["https://news.example/first"]


async def test_claim_article_extraction_batch_reclaims_expired_lease(
    store: ScoutStore,
) -> None:
    """Expired article extraction leases can be claimed by a later run."""
    await store.bulk_save_articles(
        [
            {
                "url": "https://news.example/stale",
                "title": "Stale Article",
                "published_at": "2026-07-01T10:00:00+00:00",
                "source_name": "Example News",
                "source_domain": "news.example",
                "section": "local",
                "provider": "crawl",
                "provider_id": "https://news.example/stale",
                "api_url": None,
                "metadata": {
                    "body_text_excerpt": "Carla Cruz spoke at the public meeting.",
                },
            }
        ]
    )

    first_claim = await store.claim_article_extraction_batch(
        owner_run_id="run-1",
        provider_key="provider",
        prompt_key="prompt",
        limit=1,
        lease_seconds=-1,
    )
    assert [row["url"] for row in first_claim] == ["https://news.example/stale"]

    second_claim = await store.claim_article_extraction_batch(
        owner_run_id="run-2",
        provider_key="provider",
        prompt_key="prompt",
        limit=1,
    )

    assert [row["url"] for row in second_claim] == ["https://news.example/stale"]


async def test_claim_article_extraction_batch_allows_one_concurrent_claimant(
    tmp_path,
) -> None:
    """Concurrent article extraction claims should not duplicate leased articles."""
    db_path = tmp_path / "scout.db"
    first_store = ScoutStore(str(db_path))
    second_store = ScoutStore(str(db_path))
    await first_store.initialize()
    await second_store.initialize()

    try:
        await first_store.bulk_save_articles(
            [
                {
                    "url": "https://news.example/first",
                    "title": "First Article",
                    "published_at": "2026-07-01T10:00:00+00:00",
                    "source_name": "Example News",
                    "source_domain": "news.example",
                    "section": "local",
                    "provider": "crawl",
                    "provider_id": "https://news.example/first",
                    "api_url": None,
                    "metadata": {"body_text_excerpt": "Alice Adams spoke."},
                },
                {
                    "url": "https://news.example/second",
                    "title": "Second Article",
                    "published_at": "2026-07-02T10:00:00+00:00",
                    "source_name": "Example News",
                    "source_domain": "news.example",
                    "section": "local",
                    "provider": "crawl",
                    "provider_id": "https://news.example/second",
                    "api_url": None,
                    "metadata": {"body_text_excerpt": "Brianna Brown spoke."},
                },
            ]
        )

        first_claim, second_claim = await asyncio.gather(
            first_store.claim_article_extraction_batch(
                owner_run_id="run-1",
                provider_key="provider",
                prompt_key="prompt",
                limit=2,
            ),
            second_store.claim_article_extraction_batch(
                owner_run_id="run-2",
                provider_key="provider",
                prompt_key="prompt",
                limit=2,
            ),
        )
    finally:
        await first_store.close()
        await second_store.close()

    claim_sizes = sorted([len(first_claim), len(second_claim)])
    claimed_urls = {row["url"] for row in first_claim + second_claim}
    assert claim_sizes == [0, 2]
    assert claimed_urls == {
        "https://news.example/first",
        "https://news.example/second",
    }
