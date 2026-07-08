"""Place issue, profile, and coverage methods for AtlasDataService."""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Mapping  # noqa: TC003
from typing import Any

from atlas.domains.catalog.place_profiles import PLACE_PROFILES
from atlas.domains.catalog.schemas.public import (
    Address,
    CoverageCount,
    EntityResponse,
    IssueAreaListResponse,
    IssueAreaResponse,
    IssueSignalsResponse,
    IssueSignalSummary,
    PlaceCoverageResponse,
    PlacePageContextResponse,
    PlaceProfileResponse,
    PlaceTypeCount,
)
from atlas.domains.catalog.taxonomy import (
    DOMAINS,
    ISSUE_AREAS_BY_DOMAIN,
    ISSUE_SEARCH_TERMS,
    get_issue_area_by_slug,
)
from atlas.platform.mcp.data_parts.context import DatabaseSession
from atlas.platform.mcp.data_parts.place_utils import (
    _normalize_place,
    _place_context_lookup_key,
    _place_page_context_not_found,
    _place_profile_not_found,
    _place_resource_slug,
    _place_resource_uri,
    _rows_to_dicts,
    _tokenize,
    _validate_issue_areas,
)


class PlaceDataServiceMixin:
    _database_url: str

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

    async def get_place_issue_signals(
        self,
        place: str | Mapping[str, str | None],
        *,
        kind: str | None = None,
        issue_areas: list[str] | None = None,
        top_entities_per_issue: int = 5,
    ) -> dict[str, Any]:
        """Summarize which issues Atlas represents for a place."""
        normalized_place, place_filters = await self._resolve_place_query_scope(  # type: ignore[attr-defined]
            place, kind=kind
        )
        validated_issue_areas = _validate_issue_areas(issue_areas)
        all_items = await self._search_all_entities(  # type: ignore[attr-defined]
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

    async def get_place_coverage(
        self,
        place: str | Mapping[str, str | None],
        *,
        kind: str | None = None,
        issue_areas: list[str] | None = None,
    ) -> dict[str, Any]:
        """Return structured Atlas coverage for a place."""
        normalized_place, place_filters = await self._resolve_place_query_scope(  # type: ignore[attr-defined]
            place, kind=kind
        )
        validated_issue_areas = _validate_issue_areas(issue_areas)

        all_items = await self._search_all_entities(  # type: ignore[attr-defined]
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
