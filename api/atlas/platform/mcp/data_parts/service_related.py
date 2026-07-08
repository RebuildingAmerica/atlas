"""Related-entity and moderation methods for AtlasDataService."""

from __future__ import annotations

from typing import Any

from atlas.domains.catalog.schemas.public import EntityRelationshipItem, EntityRelationshipsResponse
from atlas.models import EntryCRUD, FlagCRUD
from atlas.platform.mcp.data_parts.context import DatabaseSession, EntityRecordContext
from atlas.platform.mcp.data_parts.place_utils import _entity_not_found
from atlas.platform.mcp.data_parts.serializers import _entity_record
from atlas.platform.mcp.pagination import decode_cursor, encode_cursor


class RelatedDataServiceMixin:
    _database_url: str
    _public_url: str | None

    async def get_related_entities(
        self,
        entity_id: str,
        *,
        relation_types: list[str] | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """Return mechanically derived related entities."""
        normalized_relation_types = set(relation_types or [])
        offset = decode_cursor(cursor)

        async with DatabaseSession(self._database_url) as conn:
            entry, sources = await EntryCRUD.get_with_sources(conn, entity_id)
            if entry is None:
                raise _entity_not_found(entity_id)

            entity_issue_areas = set(await EntryCRUD.get_issue_areas(conn, entity_id))
            source_ids = {source["id"] for source in sources}

            search = await EntryCRUD.search_public(
                conn,
                states=[entry.state] if entry.state else None,
                cities=[entry.city] if entry.city else None,
                regions=[entry.region] if entry.region else None,
                limit=200,
                offset=0,
            )
            candidate_ids = [
                record["entry"].id
                for record in search["entries"]
                if record["entry"].id != entity_id
            ]
            issue_map = await EntryCRUD.get_issue_areas_for_entries(conn, candidate_ids)
            source_map = await EntryCRUD.get_sources_for_entries(conn, candidate_ids)

        items = []
        for record in search["entries"]:
            related_entry = record["entry"]
            if related_entry.id == entity_id:
                continue

            relationships: list[dict[str, Any]] = []
            if entry.affiliated_org_id == related_entry.id:
                relationships.append({"type": "affiliated_organization"})
            if related_entry.affiliated_org_id == entity_id:
                relationships.append({"type": "affiliated_member"})

            shared_issue_areas = sorted(
                entity_issue_areas & set(issue_map.get(related_entry.id, []))
            )
            if shared_issue_areas:
                relationships.append(
                    {"type": "shared_issue_area", "issue_area_ids": shared_issue_areas}
                )

            same_place = (
                entry.city == related_entry.city
                and entry.state == related_entry.state
                and entry.city is not None
                and entry.state is not None
            )
            if same_place:
                relationships.append({"type": "shared_place"})

            related_source_ids = {source["id"] for source in source_map.get(related_entry.id, [])}
            shared_source_ids = sorted(source_ids & related_source_ids)
            if shared_source_ids:
                relationships.append({"type": "shared_source", "source_ids": shared_source_ids})

            if normalized_relation_types:
                relationships = [
                    relationship
                    for relationship in relationships
                    if relationship["type"] in normalized_relation_types
                ]
            if not relationships:
                continue

            items.append(
                {
                    "entity": _entity_record(
                        related_entry,
                        EntityRecordContext(
                            issue_area_ids=issue_map.get(related_entry.id, []),
                            source_types=sorted(
                                {source["type"] for source in source_map.get(related_entry.id, [])}
                            ),
                            source_count=record["source_count"],
                            source_ids=[
                                str(source["id"]) for source in source_map.get(related_entry.id, [])
                            ],
                            latest_source_date=record["latest_source_date"],
                            public_url=self._public_url,
                        ),
                    ),
                    "relationships": relationships,
                }
            )

        total = len(items)
        page = items[offset : offset + limit]
        next_cursor = encode_cursor(offset + limit) if offset + limit < total else None

        return EntityRelationshipsResponse(
            entity_id=entity_id,
            items=[EntityRelationshipItem.model_validate(item) for item in page],
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
