"""Shared MCP data-service context types."""

from __future__ import annotations

from collections.abc import Mapping  # noqa: TC003
from typing import TYPE_CHECKING, Any, TypedDict

from atlas.models import get_db_connection

if TYPE_CHECKING:
    from aiosqlite import Connection


class EntitySearchOptions(TypedDict, total=False):
    """Optional filters for entity retrieval helpers."""

    issue_areas: list[str] | None
    text: str | None
    entity_types: list[str] | None
    source_types: list[str] | None
    sort: str | None
    limit: int
    cursor: str | None


class SourceSearchOptions(TypedDict, total=False):
    """Optional filters for source retrieval helpers."""

    issue_areas: list[str] | None
    text: str | None
    source_types: list[str] | None
    limit: int
    cursor: str | None


PlaceQueryFilter = dict[str, str | None]


class EntityRecordContext:
    """Structured metadata needed to serialize an entity record."""

    def __init__(  # noqa: PLR0913
        self,
        *,
        issue_area_ids: list[str],
        source_types: list[str],
        source_count: int,
        latest_source_date: str | None,
        source_ids: list[str] | None = None,
        contact_source_ids: list[str] | None = None,
        flag_summary: Mapping[str, Any] | None = None,
        independent_source_count: int | None = None,
        website_grounded: bool | None = None,
        email_grounded: bool | None = None,
        public_url: str | None = None,
    ) -> None:
        self.issue_area_ids = issue_area_ids
        self.source_types = source_types
        self.source_count = source_count
        self.latest_source_date = latest_source_date
        self.source_ids = source_ids or []
        self.contact_source_ids = contact_source_ids or []
        self.flag_summary = flag_summary
        self.independent_source_count = independent_source_count
        self.website_grounded = website_grounded
        self.email_grounded = email_grounded
        self.public_url = public_url


_EXHAUSTIVE_SCAN_PAGE_SIZE = 500
"""Page size for internal place-wide scans (get_place_coverage,
get_place_issue_signals). These build aggregates over every matching entity,
not just one page, so they walk search_entities's own cursor to completion
rather than reading a single capped page and silently under-counting large
places."""


class DatabaseSession:
    """Small async context manager for SQLite connections."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url
        self._conn: Connection | None = None

    async def __aenter__(self) -> Connection:
        self._conn = await get_db_connection(self._database_url)
        return self._conn

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        if self._conn is not None:
            await self._conn.close()
