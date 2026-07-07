"""Local SQLite store for Atlas Scout runs, cache, entries, and daemon state."""

from __future__ import annotations

import aiosqlite  # noqa: F401

from atlas_scout.store_article_frontier import ScoutStoreArticleFrontierMixin
from atlas_scout.store_article_stats import ScoutStoreArticleStatsMixin
from atlas_scout.store_articles import ScoutStoreArticlesMixin
from atlas_scout.store_base import ScoutStoreBase
from atlas_scout.store_daemon import ScoutStoreDaemonMixin
from atlas_scout.store_entries import ScoutStoreEntriesMixin
from atlas_scout.store_page_work import ScoutStorePageWorkMixin
from atlas_scout.store_runs import ScoutStoreRunsMixin


class ScoutStore(
    ScoutStoreBase,
    ScoutStoreDaemonMixin,
    ScoutStoreRunsMixin,
    ScoutStoreArticlesMixin,
    ScoutStoreArticleFrontierMixin,
    ScoutStoreArticleStatsMixin,
    ScoutStorePageWorkMixin,
    ScoutStoreEntriesMixin,
):
    """Async SQLite store for Scout's local state."""
