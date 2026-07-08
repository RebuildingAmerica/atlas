"""Core ScoutStore assembly and database lifecycle helpers."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas_scout.sqlite_retry import run_sqlite_write
from atlas_scout.store.article_extractions_repo import ArticleExtractionRepository
from atlas_scout.store.article_frontier_repo import ArticleFrontierRepository
from atlas_scout.store.articles_repo import ArticleRepository
from atlas_scout.store.daemon_repo import DaemonStateRepository
from atlas_scout.store.db import Database
from atlas_scout.store.entries_repo import EntryRepository
from atlas_scout.store.extraction_cache_repo import ExtractionCacheRepository
from atlas_scout.store.page_cache_repo import PageCacheRepository
from atlas_scout.store.page_tasks_repo import PageTasksRepository
from atlas_scout.store.runs_repo import RunsRepository
from atlas_scout.store.work_claims_repo import WorkClaimsRepository

if TYPE_CHECKING:
    from atlas_scout.store import ScoutStore


class ScoutStoreBaseMixin:
    """Construct and manage the shared SQLite connection."""

    def __init__(self: ScoutStore, db_path: str) -> None:
        """Store the database path; call initialize() before use."""
        self._db = Database(db_path)
        self._daemon = DaemonStateRepository(self._db)
        self._runs = RunsRepository(self._db)
        self._page_cache = PageCacheRepository(self._db)
        self._page_tasks = PageTasksRepository(self._db)
        self._extraction_cache = ExtractionCacheRepository(self._db)
        self._work_claims = WorkClaimsRepository(
            self._db, run_status_lookup=self._runs.run_status
        )
        self._entries = EntryRepository(self._db)
        self._articles = ArticleRepository(self._db)
        self._article_extractions = ArticleExtractionRepository(self._db)
        self._article_frontier = ArticleFrontierRepository(self._db)

    async def initialize(self: ScoutStore, *, create_schema: bool = True) -> None:
        """Open the database connection and create tables if needed."""
        await self._db.connect()
        if not create_schema:
            return

        async def operation() -> None:
            conn = self._db.connection
            await conn.execute("PRAGMA journal_mode=WAL")
            await conn.execute("PRAGMA synchronous=NORMAL")
            await self._runs.ensure_schema()
            await self._page_cache.ensure_schema()
            await self._page_tasks.ensure_schema()
            await self._entries.ensure_schema()
            await self._articles.ensure_schema()
            await self._article_extractions.ensure_schema()
            await self._article_frontier.ensure_schema()
            await self._extraction_cache.ensure_schema()
            await self._work_claims.ensure_schema()
            await self._daemon.ensure_schema()
            await self._daemon.ensure_default_row()
            await conn.commit()

        await run_sqlite_write(operation, on_locked=self._db.rollback_quietly)

    async def close(self: ScoutStore) -> None:
        """Close the database connection."""
        await self._db.close()

    async def list_tables(self: ScoutStore) -> list[str]:
        """Return the names of all user tables in the database."""
        return await self._db.list_tables()
