"""Place coverage helpers for `atlas.platform.mcp.data`."""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING, Any, cast

from atlas.domains.catalog.schemas.public import (
    Address,
    CoverageCount,
    EntityRelationshipItem,
    EntityRelationshipsResponse,
    PlaceCoverageResponse,
)
from atlas.domains.catalog.taxonomy import DOMAINS, ISSUE_AREAS_BY_DOMAIN
from atlas.models import EntryCRUD
from atlas.platform.mcp.pagination import decode_cursor, encode_cursor

from .data_db import DatabaseSession
from .data_place_helpers import (
    PlaceQueryFilter,
    _entity_not_found,
    _place_resource_uri,
    _validate_issue_areas,
)
from .data_record_helpers import (
    EntityRecordContext,
    _entity_record,
)

if TYPE_CHECKING:
    from collections.abc import Mapping
    from typing import Protocol

    class _PlaceSearchService(Protocol):
        async def _resolve_place_query_scope(
            self,
            place: str | Mapping[str, str | None],
            *,
            kind: str | None = None,
        ) -> tuple[dict[str, str | None], list[PlaceQueryFilter] | None]: ...

        async def _search_all_entities(
            self,
            *,
            place: str | Mapping[str, str | None] | None,
            place_filters: list[PlaceQueryFilter] | None,
            issue_areas: list[str] | None,
        ) -> list[dict[str, Any]]: ...


class AtlasDataServicePlaceCoverageMixin:
    _database_url: str
    _public_url: str | None

    async def get_place_coverage(
        self,
        place: str | Mapping[str, str | None],
        *,
        kind: str | None = None,
        issue_areas: list[str] | None = None,
    ) -> dict[str, Any]:
        """Return structured Atlas coverage for a place."""
        search_service = cast("_PlaceSearchService", self)
        normalized_place, place_filters = await search_service._resolve_place_query_scope(  # noqa: SLF001
            place, kind=kind
        )
        validated_issue_areas = _validate_issue_areas(issue_areas)

        all_items = await search_service._search_all_entities(  # noqa: SLF001
            place=normalized_place,
            place_filters=place_filters,
            issue_areas=validated_issue_areas or None,
        )
        issue_counts: dict[str, int] = defaultdict(int)
        for entity in all_items:
            for issue_area_id in entity["issue_area_ids"]:
                issue_counts[issue_area_id] += 1

        issue_pool = validated_issue_areas or [
            issue.slug for issues in ISSUE_AREAS_BY_DOMAIN.values() for issue in issues
        ]
        covered_issue_area_ids = sorted(
            [issue for issue in issue_pool if issue_counts.get(issue, 0) > 0]
        )
        thin_issue_area_ids = sorted(
            [issue for issue in issue_pool if issue_counts.get(issue, 0) == 1]
        )
        missing_issue_area_ids = sorted(
            [issue for issue in issue_pool if issue_counts.get(issue, 0) == 0]
        )
        uncovered_domains = sorted(
            [
                domain
                for domain in DOMAINS
                if not any(
                    issue_counts.get(issue.slug, 0) > 0 for issue in ISSUE_AREAS_BY_DOMAIN[domain]
                )
            ]
        )

        return PlaceCoverageResponse(
            place=Address.model_validate(normalized_place),
            entity_count=len(all_items),
            issue_counts=[
                CoverageCount(issue_area_id=issue_area_id, count=issue_counts.get(issue_area_id, 0))
                for issue_area_id in sorted(issue_pool)
            ],
            covered_issue_area_ids=covered_issue_area_ids,
            thin_issue_area_ids=thin_issue_area_ids,
            missing_issue_area_ids=missing_issue_area_ids,
            uncovered_domains=uncovered_domains,
            resource_uri=_place_resource_uri(normalized_place, "coverage"),
        ).model_dump(mode="json")

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
