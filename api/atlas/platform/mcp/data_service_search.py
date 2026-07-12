"""Search helpers for `atlas.platform.mcp.data`."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, TypedDict, Unpack

from atlas.domains.catalog.schemas.public import (
    Address,
    EntityCollectionResponse,
    IssueAreaListResponse,
    IssueAreaResponse,
    SourceCollectionResponse,
)
from atlas.domains.catalog.taxonomy import DOMAINS, ISSUE_AREAS_BY_DOMAIN, ISSUE_SEARCH_TERMS
from atlas.models import EntryCRUD, FlagCRUD
from atlas.platform.mcp.pagination import decode_cursor

from .data_db import DatabaseSession
from .data_place_helpers import (
    PlaceQueryFilter,
    _append_source_place_clauses,
    _clean_string,
    _normalize_place,
    _normalize_state,
    _place_context_lookup_key,
    _place_resource_slug,
    _tokenize,
    _validate_entity_sort,
    _validate_issue_areas,
)
from .data_record_helpers import (
    EntityRecordContext,
    _entity_record,
    _source_linked_entities_by_id,
    _source_record,
)

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence


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


_EXHAUSTIVE_SCAN_PAGE_SIZE = 500


def _exhaustive_scan_page_size() -> int:
    """Read the scan size through the public facade so tests can patch it."""
    from . import data as data_module

    return int(getattr(data_module, "_EXHAUSTIVE_SCAN_PAGE_SIZE", _EXHAUSTIVE_SCAN_PAGE_SIZE))


class AtlasDataServiceSearchMixin:
    _database_url: str
    _public_url: str | None

    async def _search_all_entities(
        self,
        *,
        place: str | Mapping[str, str | None] | None,
        place_filters: Sequence[Mapping[str, str | None]] | None,
        issue_areas: list[str] | None,
    ) -> list[dict[str, Any]]:
        """Page through every matching entity via search_entities's own cursor."""
        items: list[dict[str, Any]] = []
        cursor: str | None = None
        while True:
            page = await self.search_entities(
                place=place,
                place_filters=place_filters,
                issue_areas=issue_areas,
                limit=_exhaustive_scan_page_size(),
                cursor=cursor,
            )
            items.extend(page["items"])
            cursor = page["next_cursor"]
            if cursor is None:
                return items

    async def search_entities(  # noqa: PLR0913
        self,
        *,
        place: str | Mapping[str, str | None] | None = None,
        place_filters: Sequence[Mapping[str, str | None]] | None = None,
        issue_areas: list[str] | None = None,
        text: str | None = None,
        entity_types: list[str] | None = None,
        source_types: list[str] | None = None,
        sort: str | None = "relevance",
        limit: int = 20,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """Search Atlas entities using place, issue, and free-text filters."""
        normalized_place = _normalize_place(place)
        validated_issue_areas = _validate_issue_areas(issue_areas)
        validated_sort = _validate_entity_sort(sort)
        offset = decode_cursor(cursor)

        async with DatabaseSession(self._database_url) as conn:
            search = await EntryCRUD.search_public(
                conn,
                query=text,
                states=[normalized_place["state"]] if normalized_place["state"] else None,
                cities=[normalized_place["city"]] if normalized_place["city"] else None,
                regions=[normalized_place["region"]] if normalized_place["region"] else None,
                place_filters=place_filters,
                issue_areas=validated_issue_areas or None,
                entry_types=entity_types,
                source_types=source_types,
                sort=validated_sort,
                limit=limit,
                offset=offset,
            )
            entity_ids = [record["entry"].id for record in search["entries"]]
            flag_summaries = await FlagCRUD.entity_flag_summaries(conn, entity_ids)

        items = [
            _entity_record(
                record["entry"],
                EntityRecordContext(
                    issue_area_ids=record["issue_areas"],
                    source_types=record["source_types"],
                    source_count=record["source_count"],
                    latest_source_date=record["latest_source_date"],
                    flag_summary=flag_summaries.get(record["entry"].id),
                    public_url=self._public_url,
                ),
            )
            for record in search["entries"]
        ]
        next_cursor = None
        if offset + limit < search["total"]:
            next_cursor = str(offset + limit)

        return EntityCollectionResponse(
            items=items,
            total=search["total"],
            next_cursor=next_cursor,
            place=Address.model_validate(normalized_place),
        ).model_dump(mode="json")

    async def get_place_entities(
        self,
        place: str | Mapping[str, str | None],
        *,
        kind: str | None = None,
        **kwargs: Unpack[EntitySearchOptions],
    ) -> dict[str, Any]:
        """Convenience place-first alias for entity search."""
        normalized_place, place_filters = await self._resolve_place_query_scope(place, kind=kind)
        return await self.search_entities(
            place=normalized_place,
            place_filters=place_filters,
            **kwargs,
        )

    async def search_sources(  # noqa: PLR0913
        self,
        *,
        place: str | Mapping[str, str | None] | None = None,
        place_filters: Sequence[Mapping[str, str | None]] | None = None,
        issue_areas: list[str] | None = None,
        text: str | None = None,
        source_types: list[str] | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """Search Atlas sources with place and issue filtering."""
        normalized_place = _normalize_place(place)
        validated_issue_areas = _validate_issue_areas(issue_areas)
        offset = decode_cursor(cursor)

        clauses = ["1 = 1"]
        params: list[Any] = []

        _append_source_place_clauses(
            clauses=clauses,
            params=params,
            normalized_place=normalized_place,
            place_filters=place_filters,
        )
        if validated_issue_areas:
            placeholders = ", ".join(["?"] * len(validated_issue_areas))
            clauses.append(f"eia.issue_area IN ({placeholders})")
            params.extend(validated_issue_areas)
        if source_types:
            placeholders = ", ".join(["?"] * len(source_types))
            clauses.append(f"s.type IN ({placeholders})")
            params.extend(source_types)
        if text:
            clauses.append("(s.title LIKE ? OR s.publication LIKE ? OR s.url LIKE ?)")
            like_text = f"%{text}%"
            params.extend([like_text, like_text, like_text])

        where_clause = " AND ".join(clauses)

        async with DatabaseSession(self._database_url) as conn:
            cursor_obj = await conn.execute(
                f"""
                SELECT
                    s.id,
                    s.url,
                    s.title,
                    s.publication,
                    s.published_date,
                    s.type,
                    s.ingested_at,
                    s.extraction_method,
                    s.created_at,
                    GROUP_CONCAT(DISTINCT e.id) AS linked_entity_ids
                FROM sources s
                JOIN entry_sources es ON s.id = es.source_id
                JOIN entries e ON e.id = es.entry_id
                LEFT JOIN entry_issue_areas eia ON e.id = eia.entry_id
                WHERE {where_clause}
                GROUP BY s.id
                ORDER BY COALESCE(s.published_date, DATE(s.ingested_at)) DESC, s.ingested_at DESC
                LIMIT ? OFFSET ?
                """,
                [*params, limit, offset],
            )
            rows = await cursor_obj.fetchall()
            source_flag_summaries = await FlagCRUD.source_flag_summaries(
                conn, [row[0] for row in rows]
            )
            linked_entity_ids_by_source = {
                str(row[0]): row[9].split(",") if row[9] else [] for row in rows
            }
            linked_entities_by_id = await _source_linked_entities_by_id(
                conn,
                [
                    entity_id
                    for linked_entity_ids in linked_entity_ids_by_source.values()
                    for entity_id in linked_entity_ids
                ],
            )

        items = []
        for row in rows:
            linked_entity_ids = linked_entity_ids_by_source[str(row[0])]
            items.append(
                _source_record(
                    {
                        "id": row[0],
                        "url": row[1],
                        "title": row[2],
                        "publication": row[3],
                        "published_date": row[4],
                        "type": row[5],
                        "ingested_at": row[6],
                        "extraction_method": row[7],
                        "created_at": row[8],
                    },
                    linked_entity_ids=linked_entity_ids,
                    linked_entities=[
                        linked_entities_by_id[entity_id]
                        for entity_id in linked_entity_ids
                        if entity_id in linked_entities_by_id
                    ],
                    flag_summary=source_flag_summaries.get(row[0]),
                )
            )

        next_cursor = None if len(items) < limit else str(offset + limit)
        return SourceCollectionResponse(
            items=items,
            total=len(items) if next_cursor is None else offset + len(items) + 1,
            next_cursor=next_cursor,
            place=Address.model_validate(normalized_place),
        ).model_dump(mode="json")

    async def get_place_sources(
        self,
        place: str | Mapping[str, str | None],
        *,
        kind: str | None = None,
        **kwargs: Unpack[SourceSearchOptions],
    ) -> dict[str, Any]:
        """Convenience place-first alias for source search."""
        normalized_place, place_filters = await self._resolve_place_query_scope(place, kind=kind)
        return await self.search_sources(
            place=normalized_place,
            place_filters=place_filters,
            **kwargs,
        )

    async def _resolve_place_query_scope(
        self,
        place: str | Mapping[str, str | None],
        *,
        kind: str | None = None,
    ) -> tuple[dict[str, str | None], list[PlaceQueryFilter] | None]:
        """Return stored place filter rows for context-backed place pages."""
        normalized_place = _normalize_place(place)
        place_key = _place_context_lookup_key(_place_resource_slug(normalized_place), kind)

        async with DatabaseSession(self._database_url) as conn:
            filter_cursor = await conn.execute(
                """
                SELECT city, state, region
                FROM place_query_filters
                WHERE place_key = ?
                ORDER BY sort_order, city, state, region
                """,
                [place_key],
            )
            filter_rows = await filter_cursor.fetchall()
            if filter_rows:
                return (
                    normalized_place,
                    [
                        {
                            "city": _clean_string(row[0]),
                            "state": _normalize_state(row[1]),
                            "region": _clean_string(row[2]),
                        }
                        for row in filter_rows
                    ],
                )

            context_cursor = await conn.execute(
                "SELECT 1 FROM place_contexts WHERE place_key = ?",
                [place_key],
            )
            context_exists = await context_cursor.fetchone()

        if context_exists:
            return normalized_place, []
        return normalized_place, None

    async def resolve_issue_areas(self, text: str, limit: int = 10) -> dict[str, Any]:
        """Resolve natural language into Atlas issue areas."""
        query_tokens = set(_tokenize(text))
        scored: list[IssueAreaResponse] = []

        for domain in DOMAINS:
            for issue in ISSUE_AREAS_BY_DOMAIN[domain]:
                terms = ISSUE_SEARCH_TERMS.get(issue.slug, [])
                haystacks = [
                    issue.slug.replace("_", " "),
                    issue.name.lower(),
                    issue.description.lower(),
                    *terms,
                ]
                score = 0.0

                for haystack in haystacks:
                    lowered = haystack.lower()
                    if lowered in text.lower():
                        score += 5.0
                    haystack_tokens = set(_tokenize(lowered))
                    score += len(query_tokens & haystack_tokens)

                if score <= 0:
                    continue

                scored.append(
                    IssueAreaResponse(
                        id=issue.slug,
                        slug=issue.slug,
                        name=issue.name,
                        domain=issue.domain,
                        description=issue.description,
                        match_score=score,
                    )
                )

        scored.sort(key=lambda item: (-(item.match_score or 0.0), item.slug))
        limited = scored[:limit]
        return IssueAreaListResponse(
            items=limited, total=len(limited), next_cursor=None
        ).model_dump(mode="json")
