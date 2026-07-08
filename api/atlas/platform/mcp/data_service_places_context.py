"""Place context helpers for `atlas.platform.mcp.data`."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import TYPE_CHECKING, Any, cast

from atlas.domains.catalog.place_profiles import PLACE_PROFILES
from atlas.domains.catalog.schemas.public import (
    Address,
    EntityResponse,
    IssueSignalsResponse,
    IssueSignalSummary,
    PlacePageContextResponse,
    PlaceProfileResponse,
    PlaceTypeCount,
)
from atlas.domains.catalog.taxonomy import get_issue_area_by_slug

from .data_db import DatabaseSession
from .data_place_helpers import (
    PlaceQueryFilter,
    _normalize_place,
    _place_context_lookup_key,
    _place_page_context_not_found,
    _place_profile_not_found,
    _place_resource_slug,
    _place_resource_uri,
    _validate_issue_areas,
)
from .data_record_helpers import _rows_to_dicts

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


class AtlasDataServicePlaceContextMixin:
    _database_url: str

    async def get_place_issue_signals(
        self,
        place: str | Mapping[str, str | None],
        *,
        kind: str | None = None,
        issue_areas: list[str] | None = None,
        top_entities_per_issue: int = 5,
    ) -> dict[str, Any]:
        """Summarize which issues Atlas represents for a place."""
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

        entities_by_issue: dict[str, list[dict[str, Any]]] = defaultdict(list)
        source_count_by_issue: Counter[str] = Counter()
        type_counts_by_issue: dict[str, Counter[str]] = defaultdict(Counter)

        for entity in all_items:
            for issue_area_id in entity["issue_area_ids"]:
                if validated_issue_areas and issue_area_id not in validated_issue_areas:
                    continue
                entities_by_issue[issue_area_id].append(entity)
                source_count_by_issue[issue_area_id] += int(entity["source_count"])
                type_counts_by_issue[issue_area_id][entity["type"]] += 1

        issues = []
        for issue_area_id, entities in sorted(
            entities_by_issue.items(),
            key=lambda item: (-len(item[1]), item[0]),
        ):
            issue = get_issue_area_by_slug(issue_area_id)
            issues.append(
                IssueSignalSummary(
                    issue_area_id=issue_area_id,
                    name=issue.name if issue else issue_area_id,
                    domain=issue.domain if issue else None,
                    entity_count=len(entities),
                    source_count=source_count_by_issue[issue_area_id],
                    entity_type_counts=[
                        PlaceTypeCount(type=entity_type, count=count)
                        for entity_type, count in sorted(
                            type_counts_by_issue[issue_area_id].items()
                        )
                    ],
                    top_entities=[
                        EntityResponse.model_validate(entity)
                        for entity in entities[:top_entities_per_issue]
                    ],
                )
            )

        return IssueSignalsResponse(
            place=Address.model_validate(normalized_place),
            issues=issues,
            resource_uri=_place_resource_uri(normalized_place, "issue-signals"),
        ).model_dump(mode="json")

    async def get_place_profile(
        self,
        place: str | Mapping[str, str | None],
        *,
        kind: str | None = None,
    ) -> dict[str, Any]:
        """Return structured demographic and socioeconomic context for a place."""
        normalized_place = _normalize_place(place)
        place_key = _place_context_lookup_key(_place_resource_slug(normalized_place), kind)
        profile_key = _place_resource_slug(normalized_place)
        if kind and place_key in PLACE_PROFILES:
            profile_key = place_key
        profile = PLACE_PROFILES.get(profile_key)
        if profile is None:
            raise _place_profile_not_found(str(normalized_place["display"]))

        return PlaceProfileResponse.model_validate(
            {
                "place": normalized_place,
                **profile,
                "resource_uri": _place_resource_uri(normalized_place, "profile"),
            }
        ).model_dump(mode="json")

    async def get_place_page_context(
        self,
        place: str | Mapping[str, str | None],
        *,
        kind: str | None = None,
    ) -> dict[str, Any]:
        """Return database-backed context for a public place page."""
        normalized_place = _normalize_place(place)
        place_key = _place_context_lookup_key(_place_resource_slug(normalized_place), kind)

        async with DatabaseSession(self._database_url) as conn:
            context_cursor = await conn.execute(
                """
                SELECT place_key, name, display, kind, source_dataset, source_identifier, source_url
                FROM place_contexts
                WHERE place_key = ?
                """,
                [place_key],
            )
            context_row = await context_cursor.fetchone()
            if context_row is None:
                raise _place_page_context_not_found(place_key)
            context_columns = [column[0] for column in context_cursor.description]
            context = dict(zip(context_columns, context_row, strict=False))

            scopes_cursor = await conn.execute(
                """
                SELECT label, href, active
                FROM place_scope_links
                WHERE place_key = ?
                ORDER BY sort_order, label
                """,
                [place_key],
            )
            scopes = _rows_to_dicts(scopes_cursor, await scopes_cursor.fetchall())

            facts_cursor = await conn.execute(
                """
                SELECT label, value, attribution
                FROM place_summary_facts
                WHERE place_key = ?
                ORDER BY sort_order, label
                """,
                [place_key],
            )
            facts = _rows_to_dicts(facts_cursor, await facts_cursor.fetchall())

            governments_cursor = await conn.execute(
                """
                SELECT id, name, role
                FROM place_governments
                WHERE place_key = ?
                ORDER BY sort_order, name
                """,
                [place_key],
            )
            governments = _rows_to_dicts(
                governments_cursor,
                await governments_cursor.fetchall(),
            )

            government_ids = [government["id"] for government in governments]
            government_links: dict[str, list[dict[str, Any]]] = defaultdict(list)
            if government_ids:
                placeholders = ",".join("?" for _ in government_ids)
                links_cursor = await conn.execute(
                    f"""
                    SELECT government_id, label, href
                    FROM place_government_links
                    WHERE government_id IN ({placeholders})
                    ORDER BY sort_order, label
                    """,
                    government_ids,
                )
                for link in _rows_to_dicts(links_cursor, await links_cursor.fetchall()):
                    government_links[str(link["government_id"])].append(
                        {"label": link["label"], "href": link["href"]}
                    )

            related_cursor = await conn.execute(
                """
                SELECT
                    name,
                    href,
                    kind,
                    summary,
                    accent,
                    latitude,
                    longitude,
                    source_dataset,
                    source_identifier,
                    source_url
                FROM place_related_places
                WHERE place_key = ?
                ORDER BY sort_order, name
                """,
                [place_key],
            )
            related_places = _rows_to_dicts(related_cursor, await related_cursor.fetchall())

        return PlacePageContextResponse.model_validate(
            {
                **context,
                "scopes": scopes,
                "summary_facts": facts,
                "governments": [
                    {
                        "name": government["name"],
                        "role": government["role"],
                        "links": government_links.get(str(government["id"]), []),
                    }
                    for government in governments
                ],
                "places": related_places,
                "resource_uri": _place_resource_uri(normalized_place, "page-context"),
            }
        ).model_dump(mode="json")
