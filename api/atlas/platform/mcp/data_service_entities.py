"""Entity and discovery helpers for `atlas.platform.mcp.data`."""

from __future__ import annotations

from typing import Any

from atlas.domains.catalog.schemas.public import (
    DiscoveryRunCollectionResponse,
    EntityDetailResponse,
    EntitySourcesResponse,
)
from atlas.models import DiscoveryRunCRUD, EntryCRUD, FlagCRUD
from atlas.platform.mcp.pagination import decode_cursor, encode_cursor

from .data_db import DatabaseSession
from .data_place_helpers import (
    _discovery_run_not_found,
    _entity_not_found,
)
from .data_record_helpers import (
    EntityRecordContext,
    _discovery_run_record,
    _entity_record,
    _latest_source_date,
    _relationship_ids,
    _source_linked_entity_record,
    _source_record,
)
from .data_trust_helpers import _contact_source_ids, _trust_inputs_from_sources


class AtlasDataServiceEntityMixin:
    _database_url: str
    _public_url: str | None

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

        Suppressed sources (hidden by the verified subject) are excluded from the
        public response. Set ``include_suppressed=True`` for admin or
        subject-self views to see them.
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

        Suppressed sources (hidden by the verified subject) are excluded by
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

    async def create_entity_flag(
        self,
        entity_id: str,
        *,
        reason: str,
        note: str | None = None,
    ) -> dict[str, Any]:
        """Create a moderation flag for an Atlas entity."""
        async with DatabaseSession(self._database_url) as conn:
            flag = await FlagCRUD.create_entity_flag(
                conn,
                entity_id=entity_id,
                reason=reason,
                note=note,
            )
            return {
                "id": flag.id,
                "entity_id": entity_id,
                "reason": flag.reason,
                "status": flag.status,
            }

    async def create_source_flag(
        self,
        source_id: str,
        *,
        reason: str,
        note: str | None = None,
    ) -> dict[str, Any]:
        """Create a moderation flag for an Atlas source."""
        async with DatabaseSession(self._database_url) as conn:
            flag = await FlagCRUD.create_source_flag(
                conn,
                source_id=source_id,
                reason=reason,
                note=note,
            )
            return {
                "id": flag.id,
                "source_id": source_id,
                "reason": flag.reason,
                "status": flag.status,
            }
