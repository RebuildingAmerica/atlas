"""Article crawl runner tests."""

from typing import Any

from atlas_scout.articles.crawl_runner import _refresh_domain_saved_counts


class _StatsStore:
    async def article_domain_counts(self) -> dict[str, int]:
        return {"dominant.test": 1500, "other.test": 12}

    async def article_stats(self) -> dict[str, Any]:
        raise AssertionError("refresh should not scan full article stats")


async def test_refresh_domain_saved_counts_merges_shared_store_counts() -> None:
    domain_saved_counts = {"dominant.test": 532, "local.test": 4}

    await _refresh_domain_saved_counts(
        _StatsStore(),
        domain_saved_counts,
        max_save_per_domain=1500,
    )

    assert domain_saved_counts == {
        "dominant.test": 1500,
        "local.test": 4,
        "other.test": 12,
    }
