"""Entity and discovery methods for AtlasDataService."""

from __future__ import annotations

from collections.abc import Mapping, Sequence  # noqa: TC003
from typing import Any, Unpack

from atlas.domains.catalog.schemas.public import (
    Address,
    DiscoveryRunCollectionResponse,
    EntityCollectionResponse,
    EntityDetailResponse,
    EntitySourcesResponse,
)
from atlas.models import DiscoveryRunCRUD, EntryCRUD, FlagCRUD
from atlas.platform.mcp.data_parts.context import (
    DatabaseSession,
    EntityRecordContext,
    EntitySearchOptions,
)
from atlas.platform.mcp.data_parts.place_utils import (
    _discovery_run_not_found,
    _entity_not_found,
    _normalize_place,
    _validate_entity_sort,
    _validate_issue_areas,
)
from atlas.platform.mcp.data_parts.serializers import (
    _discovery_run_record,
    _entity_record,
    _latest_source_date,
    _relationship_ids,
    _source_linked_entity_record,
    _source_record,
)
from atlas.platform.mcp.data_parts.trust import _contact_source_ids, _trust_inputs_from_sources
from atlas.platform.mcp.pagination import decode_cursor, encode_cursor

_EXHAUSTIVE_SCAN_PAGE_SIZE = 500


class EntityDataServiceMixin:
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
                limit=_EXHAUSTIVE_SCAN_PAGE_SIZE,
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
        normalized_place, place_filters = await self._resolve_place_query_scope(  # type: ignore[attr-defined]
            place, kind=kind
        )
        return await self.search_entities(
            place=normalized_place,
            place_filters=place_filters,
            **kwargs,
        )

    async def list_discovery_runs(
        self,
        *,
        state: str | None = None,
        status: str | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """List structured discovery-run artifacts for agent research workflows."""
        offset = decode_cursor(cursor)
        async with DatabaseSession(self._database_url) as conn:
            runs = await DiscoveryRunCRUD.list(
                conn,
                state=state,
                status=status,
                limit=limit,
                offset=offset,
            )
            total = await DiscoveryRunCRUD.count(conn, state=state, status=status)

        next_cursor = None
        if offset + limit < total:
            next_cursor = str(offset + limit)

        return DiscoveryRunCollectionResponse(
            items=[_discovery_run_record(run) for run in runs],
            total=total,
            next_cursor=next_cursor,
        ).model_dump(mode="json")

    async def get_discovery_run(self, run_id: str) -> dict[str, Any]:
        """Get one structured discovery-run artifact by ID."""
        async with DatabaseSession(self._database_url) as conn:
            run = await DiscoveryRunCRUD.get_by_id(conn, run_id)
            if run is None:
                raise _discovery_run_not_found(run_id)
        return _discovery_run_record(run)

    async def get_entity(
        self, entity_id: str, *, include_suppressed: bool = False
    ) -> dict[str, Any]:
        """Get one Atlas entity.

        Suppressed sources (hidden by a verified representative) are excluded from the
        public response. Set ``include_suppressed=True`` for admin or
        verified-representative views to see them.
        """
        async with DatabaseSession(self._database_url) as conn:
            entry, sources = await EntryCRUD.get_with_sources(conn, entity_id)
            if entry is None:
                raise _entity_not_found(entity_id)
            suppressed_ids = set(entry.suppressed_source_ids or [])
            if suppressed_ids and not include_suppressed:
                sources = [source for source in sources if source["id"] not in suppressed_ids]
            issue_area_ids = await EntryCRUD.get_issue_areas(conn, entity_id)
            entity_flag_summaries = await FlagCRUD.entity_flag_summaries(conn, [entity_id])
            source_flag_summaries = await FlagCRUD.source_flag_summaries(
                conn, [source["id"] for source in sources]
            )

        source_records = [
            _source_record(
                source,
                linked_entity_ids=[entity_id],
                linked_entities=[
                    _source_linked_entity_record(entry, issue_area_ids=issue_area_ids)
                ],
                extraction_context=source["extraction_context"],
                flag_summary=source_flag_summaries.get(source["id"]),
            )
            for source in sources
        ]
        independent_source_count, website_grounded, email_grounded = _trust_inputs_from_sources(
            entry, sources
        )
        entity = _entity_record(
            entry,
            EntityRecordContext(
                issue_area_ids=issue_area_ids,
                source_types=sorted({source["type"] for source in sources}),
                source_count=len(sources),
                source_ids=[str(source["id"]) for source in sources],
                contact_source_ids=_contact_source_ids(entry, sources),
                latest_source_date=_latest_source_date(sources, entry.last_seen.isoformat()),
                flag_summary=entity_flag_summaries.get(entity_id),
                independent_source_count=independent_source_count,
                website_grounded=website_grounded,
                email_grounded=email_grounded,
                public_url=self._public_url,
            ),
        )
        entity["source_ids"] = [source["id"] for source in sources]
        entity["relationship_ids"] = _relationship_ids(entity_id, entry, issue_area_ids)
        entity["sources"] = source_records
        return EntityDetailResponse.model_validate(entity).model_dump(mode="json")

    async def get_entity_sources(
        self,
        entity_id: str,
        *,
        include_suppressed: bool = False,
        limit: int = 20,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """Return supporting sources for one entity.

        Suppressed sources (hidden by a verified representative) are excluded by
        default. Pass ``include_suppressed=True`` for admin views.
        """
        offset = decode_cursor(cursor)
        async with DatabaseSession(self._database_url) as conn:
            entry, sources = await EntryCRUD.get_with_sources(conn, entity_id)
            if entry is None:
                raise _entity_not_found(entity_id)
            suppressed_ids = set(entry.suppressed_source_ids or [])
            if suppressed_ids and not include_suppressed:
                sources = [source for source in sources if source["id"] not in suppressed_ids]
            issue_area_ids = await EntryCRUD.get_issue_areas(conn, entity_id)
            source_flag_summaries = await FlagCRUD.source_flag_summaries(
                conn, [source["id"] for source in sources]
            )

        total = len(sources)
        page = sources[offset : offset + limit]
        next_cursor = encode_cursor(offset + limit) if offset + limit < total else None

        return EntitySourcesResponse(
            entity_id=entity_id,
            sources=[
                _source_record(
                    source,
                    linked_entity_ids=[entity_id],
                    linked_entities=[
                        _source_linked_entity_record(entry, issue_area_ids=issue_area_ids)
                    ],
                    extraction_context=source["extraction_context"],
                    flag_summary=source_flag_summaries.get(source["id"]),
                )
                for source in page
            ],
            total=total,
            next_cursor=next_cursor,
        ).model_dump(mode="json")
