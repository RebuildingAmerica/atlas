"""Place-first Atlas data service for MCP tools and public APIs."""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Any, TypedDict, Unpack
from urllib.parse import urlparse

from atlas.domains.catalog.models.entry import actor_quality, trust_tier
from atlas.domains.catalog.place_profiles import PLACE_PROFILES
from atlas.domains.catalog.schemas.public import (
    Address,
    ClaimEvidence,
    ClaimEvidenceSet,
    CoverageCount,
    DiscoveryRunCollectionResponse,
    EntityCollectionResponse,
    EntityDetailResponse,
    EntityRelationshipItem,
    EntityRelationshipsResponse,
    EntityResponse,
    EntitySourcesResponse,
    FlagSummary,
    FreshnessInfo,
    IssueAreaListResponse,
    IssueAreaResponse,
    IssueSignalsResponse,
    IssueSignalSummary,
    PlaceCoverageResponse,
    PlacePageContextResponse,
    PlaceProfileResponse,
    PlaceTypeCount,
    ProfileAnswers,
    SourceCollectionResponse,
    SourceResponse,
    TrustInfo,
)
from atlas.domains.catalog.taxonomy import (
    DOMAINS,
    ISSUE_AREAS_BY_DOMAIN,
    ISSUE_SEARCH_TERMS,
    get_issue_area_by_slug,
)
from atlas.models import DiscoveryRunCRUD, EntryCRUD, FlagCRUD, get_db_connection
from atlas.schemas import DiscoveryRunResponse

__all__ = ["AtlasDataService"]

if TYPE_CHECKING:
    from aiosqlite import Connection

    from atlas.domains.catalog.models.entry import EntryModel
    from atlas.domains.discovery.models import DiscoveryRunModel

_WORD_RE = re.compile(r"[a-z0-9]+")
MIN_PLACE_KEY_PARTS = 2
PLACE_KEY_STATE_PARTS = 2
FRESHNESS_DAYS = 180
AGING_DAYS = 365
_STATE_NAMES = {
    "alabama": "AL",
    "alaska": "AK",
    "arizona": "AZ",
    "arkansas": "AR",
    "california": "CA",
    "colorado": "CO",
    "connecticut": "CT",
    "delaware": "DE",
    "district of columbia": "DC",
    "florida": "FL",
    "georgia": "GA",
    "hawaii": "HI",
    "idaho": "ID",
    "illinois": "IL",
    "indiana": "IN",
    "iowa": "IA",
    "kansas": "KS",
    "kentucky": "KY",
    "louisiana": "LA",
    "maine": "ME",
    "maryland": "MD",
    "massachusetts": "MA",
    "michigan": "MI",
    "minnesota": "MN",
    "mississippi": "MS",
    "missouri": "MO",
    "montana": "MT",
    "nebraska": "NE",
    "nevada": "NV",
    "new hampshire": "NH",
    "new jersey": "NJ",
    "new mexico": "NM",
    "new york": "NY",
    "north carolina": "NC",
    "north dakota": "ND",
    "ohio": "OH",
    "oklahoma": "OK",
    "oregon": "OR",
    "pennsylvania": "PA",
    "rhode island": "RI",
    "south carolina": "SC",
    "south dakota": "SD",
    "tennessee": "TN",
    "texas": "TX",
    "utah": "UT",
    "vermont": "VT",
    "virginia": "VA",
    "washington": "WA",
    "west virginia": "WV",
    "wisconsin": "WI",
    "wyoming": "WY",
}


class EntitySearchOptions(TypedDict, total=False):
    """Optional filters for entity retrieval helpers."""

    issue_areas: list[str] | None
    text: str | None
    entity_types: list[str] | None
    source_types: list[str] | None
    limit: int
    cursor: str | None


class SourceSearchOptions(TypedDict, total=False):
    """Optional filters for source retrieval helpers."""

    issue_areas: list[str] | None
    text: str | None
    source_types: list[str] | None
    limit: int
    cursor: str | None


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


class AtlasDataService:
    """Structured place/entity retrieval service for agents and APIs."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    async def search_entities(  # noqa: PLR0913
        self,
        *,
        place: str | Mapping[str, str | None] | None = None,
        issue_areas: list[str] | None = None,
        text: str | None = None,
        entity_types: list[str] | None = None,
        source_types: list[str] | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """Search Atlas entities using place, issue, and free-text filters."""
        normalized_place = _normalize_place(place)
        validated_issue_areas = _validate_issue_areas(issue_areas)
        offset = _decode_cursor(cursor)

        async with DatabaseSession(self._database_url) as conn:
            search = await EntryCRUD.search_public(
                conn,
                query=text,
                states=[normalized_place["state"]] if normalized_place["state"] else None,
                cities=[normalized_place["city"]] if normalized_place["city"] else None,
                regions=[normalized_place["region"]] if normalized_place["region"] else None,
                issue_areas=validated_issue_areas or None,
                entry_types=entity_types,
                source_types=source_types,
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
        **kwargs: Unpack[EntitySearchOptions],
    ) -> dict[str, Any]:
        """Convenience place-first alias for entity search."""
        return await self.search_entities(place=place, **kwargs)

    async def list_discovery_runs(
        self,
        *,
        state: str | None = None,
        status: str | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """List structured discovery-run artifacts for agent research workflows."""
        offset = _decode_cursor(cursor)
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
                linked_entities=[_source_linked_entity_record(entry)],
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
            ),
        )
        entity["source_ids"] = [source["id"] for source in sources]
        entity["relationship_ids"] = _relationship_ids(entity_id, entry, issue_area_ids)
        entity["sources"] = source_records
        return EntityDetailResponse.model_validate(entity).model_dump(mode="json")

    async def get_entity_sources(
        self, entity_id: str, *, include_suppressed: bool = False
    ) -> dict[str, Any]:
        """Return supporting sources for one entity.

        Suppressed sources (hidden by the verified subject) are excluded by
        default. Pass ``include_suppressed=True`` for admin views.
        """
        async with DatabaseSession(self._database_url) as conn:
            entry, sources = await EntryCRUD.get_with_sources(conn, entity_id)
            if entry is None:
                raise _entity_not_found(entity_id)
            suppressed_ids = set(entry.suppressed_source_ids or [])
            if suppressed_ids and not include_suppressed:
                sources = [source for source in sources if source["id"] not in suppressed_ids]
            source_flag_summaries = await FlagCRUD.source_flag_summaries(
                conn, [source["id"] for source in sources]
            )

        return EntitySourcesResponse(
            entity_id=entity_id,
            sources=[
                _source_record(
                    source,
                    linked_entity_ids=[entity_id],
                    linked_entities=[_source_linked_entity_record(entry)],
                    extraction_context=source["extraction_context"],
                    flag_summary=source_flag_summaries.get(source["id"]),
                )
                for source in sources
            ],
        ).model_dump(mode="json")

    async def search_sources(  # noqa: PLR0913
        self,
        *,
        place: str | Mapping[str, str | None] | None = None,
        issue_areas: list[str] | None = None,
        text: str | None = None,
        source_types: list[str] | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """Search Atlas sources with place and issue filtering."""
        normalized_place = _normalize_place(place)
        validated_issue_areas = _validate_issue_areas(issue_areas)
        offset = _decode_cursor(cursor)

        clauses = ["1 = 1"]
        params: list[Any] = []

        if normalized_place["state"]:
            clauses.append("e.state = ?")
            params.append(normalized_place["state"])
        if normalized_place["city"]:
            clauses.append("e.city = ?")
            params.append(normalized_place["city"])
        if normalized_place["region"]:
            clauses.append("e.region = ?")
            params.append(normalized_place["region"])
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
                ORDER BY COALESCE(s.published_date, substr(s.ingested_at, 1, 10)) DESC, s.ingested_at DESC
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
        **kwargs: Unpack[SourceSearchOptions],
    ) -> dict[str, Any]:
        """Convenience place-first alias for source search."""
        return await self.search_sources(place=place, **kwargs)

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
        issue_areas: list[str] | None = None,
        top_entities_per_issue: int = 5,
    ) -> dict[str, Any]:
        """Summarize which issues Atlas represents for a place."""
        normalized_place = _normalize_place(place)
        validated_issue_areas = _validate_issue_areas(issue_areas)
        search = await self.search_entities(
            place=normalized_place,
            issue_areas=validated_issue_areas or None,
            limit=500,
        )

        entities_by_issue: dict[str, list[dict[str, Any]]] = defaultdict(list)
        source_count_by_issue: Counter[str] = Counter()
        type_counts_by_issue: dict[str, Counter[str]] = defaultdict(Counter)

        for entity in search["items"]:
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

    async def get_place_profile(self, place: str | Mapping[str, str | None]) -> dict[str, Any]:
        """Return structured demographic and socioeconomic context for a place."""
        normalized_place = _normalize_place(place)
        profile_key = _place_resource_slug(normalized_place)
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
    ) -> dict[str, Any]:
        """Return database-backed context for a public place page."""
        normalized_place = _normalize_place(place)
        place_key = _place_resource_slug(normalized_place)

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
        issue_areas: list[str] | None = None,
    ) -> dict[str, Any]:
        """Return structured Atlas coverage for a place."""
        normalized_place = _normalize_place(place)
        validated_issue_areas = _validate_issue_areas(issue_areas)

        search = await self.search_entities(
            place=normalized_place,
            issue_areas=validated_issue_areas or None,
            limit=500,
        )
        issue_counts: dict[str, int] = defaultdict(int)
        for entity in search["items"]:
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
            entity_count=search["total"],
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
    ) -> dict[str, Any]:
        """Return mechanically derived related entities."""
        normalized_relation_types = set(relation_types or [])

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
                        ),
                    ),
                    "relationships": relationships,
                }
            )

        return EntityRelationshipsResponse(
            entity_id=entity_id,
            items=[EntityRelationshipItem.model_validate(item) for item in items[:limit]],
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


def _validate_issue_areas(issue_areas: list[str] | None) -> list[str]:
    validated = issue_areas or []
    invalid = [issue_area for issue_area in validated if get_issue_area_by_slug(issue_area) is None]
    if invalid:
        raise _invalid_issue_areas(invalid)
    return validated


def _normalize_place(place: str | Mapping[str, str | None] | None) -> dict[str, str | None]:
    if place is None:
        return {"city": None, "state": None, "region": None, "display": None}

    if isinstance(place, Mapping):
        city = _clean_string(place.get("city"))
        state = _normalize_state(place.get("state"))
        region = _clean_string(place.get("region"))
        display = _clean_string(place.get("display")) or _format_place(city, state, region)
        return {"city": city, "state": state, "region": region, "display": display}

    raw_place = place.strip()
    if re.fullmatch(r"[A-Za-z]{2}", raw_place):
        state = _normalize_state(raw_place)
        return {"city": None, "state": state, "region": None, "display": state}

    parts = [part.strip() for part in raw_place.split(",") if part.strip()]
    city = parts[0] if parts else raw_place or None
    state = _normalize_state(parts[1]) if len(parts) > 1 else None
    return {
        "city": _clean_string(city),
        "state": state,
        "region": None,
        "display": _format_place(city, state, None),
    }


def normalize_place_key(place_key: str) -> dict[str, str | None]:
    """Parse an Atlas place key like `gary-in` or `ut`."""
    cleaned = place_key.strip().lower()
    if re.fullmatch(r"[a-z]{2}", cleaned):
        state = _normalize_state(cleaned)
        return {"city": None, "state": state, "region": None, "display": state}

    parts = [part for part in cleaned.split("-") if part]
    if len(parts) < MIN_PLACE_KEY_PARTS:
        raise _unsupported_place_key(place_key)
    state = _normalize_state(parts[-1])
    city = " ".join(part.title() for part in parts[:-1])
    return {
        "city": city,
        "state": state,
        "region": None,
        "display": _format_place(city, state, None),
    }


def _registrable_domain(url: str | None) -> str | None:
    """Return the lowercased registrable host for a URL, or None if unparseable."""
    if not url or "://" not in url:
        return None
    host = urlparse(url).netloc.lower()
    if host.startswith("www."):
        host = host.removeprefix("www.")
    return host or None


def _host_grounded(host: str, sources: Sequence[Mapping[str, Any]]) -> bool:
    """Whether a host is supported by any source's own domain or quoted context."""
    for source in sources:
        if host in (source.get("extraction_context") or "").lower():
            return True
        if _registrable_domain(source.get("url")) == host:
            return True
    return False


def _trust_inputs_from_sources(
    entry: EntryModel, sources: Sequence[Mapping[str, Any]]
) -> tuple[int, bool, bool]:
    """Derive corroboration breadth and contact grounding from linked sources."""
    domains = {
        domain
        for source in sources
        if (domain := _registrable_domain(source.get("url"))) is not None
    }
    website_host = _registrable_domain(entry.website)
    website_grounded = website_host is not None and _host_grounded(website_host, sources)
    email = (entry.email or "").lower()
    email_grounded = bool(email) and any(
        email in (source.get("extraction_context") or "").lower() for source in sources
    )
    return len(domains), website_grounded, email_grounded


def _contact_source_ids(entry: EntryModel, sources: Sequence[Mapping[str, Any]]) -> list[str]:
    """Return source IDs whose URL or context supports visible contact fields."""
    website_host = _registrable_domain(entry.website)
    email = (entry.email or "").lower()
    source_ids: list[str] = []
    for source in sources:
        context = (source.get("extraction_context") or "").lower()
        supports_website = website_host is not None and (
            website_host in context or _registrable_domain(source.get("url")) == website_host
        )
        supports_email = bool(email) and email in context
        if supports_website or supports_email:
            source_id = source.get("id")
            if source_id is not None:
                source_ids.append(str(source_id))
    return source_ids


def _trust_level(*, entry: EntryModel, independent_source_count: int | None) -> str:
    """Honest trust tier; never overclaims for thinly-sourced auto entries."""
    return trust_tier(
        verified=entry.verified,
        claim_status=entry.claim_status,
        independent_source_count=independent_source_count or 0,
    )


def _claim_confidence(
    *,
    entry: EntryModel,
    independent_source_count: int | None,
    source_count: int,
) -> str:
    """Return a confidence label for source-backed visible profile claims."""
    level = _trust_level(entry=entry, independent_source_count=independent_source_count)
    if level in {"subject_verified", "atlas_verified", "corroborated"}:
        return level
    return "unverified" if source_count <= 1 else "corroborated"


def _contact_claim_source_count(entry: EntryModel, context: EntityRecordContext) -> int:
    """Count visible contact channels backed by linked-source evidence."""
    count = 0
    if entry.website and context.website_grounded:
        count += 1
    if entry.email and context.email_grounded:
        count += 1
    return count


def _contact_claim_confidence(entry: EntryModel, context: EntityRecordContext) -> str:
    """Return a conservative confidence label for visible contact fields."""
    visible_channels = int(bool(entry.website)) + int(bool(entry.email)) + int(bool(entry.phone))
    if visible_channels == 0:
        return "unverified"

    grounded_channels = _contact_claim_source_count(entry, context)
    if grounded_channels == visible_channels:
        return _claim_confidence(
            entry=entry,
            independent_source_count=context.independent_source_count,
            source_count=max(grounded_channels, context.source_count),
        )
    if grounded_channels > 0:
        return "partial"
    return "unverified"


def _claim_evidence_set(
    *,
    entry: EntryModel,
    context: EntityRecordContext,
    verification_level: str,
) -> ClaimEvidenceSet:
    """Build evidence metadata for the visible facts on a profile."""
    base = ClaimEvidence(
        source_count=context.source_count,
        source_ids=context.source_ids,
        confidence=_claim_confidence(
            entry=entry,
            independent_source_count=context.independent_source_count,
            source_count=context.source_count,
        ),
        as_of=context.latest_source_date,
        verification_level=verification_level,
    )
    return ClaimEvidenceSet(
        summary=base,
        place=base,
        issues=base,
        contact=ClaimEvidence(
            source_count=(
                len(context.contact_source_ids)
                if context.contact_source_ids
                else _contact_claim_source_count(entry, context)
            ),
            source_ids=context.contact_source_ids,
            confidence=_contact_claim_confidence(entry, context),
            as_of=context.latest_source_date,
            verification_level=verification_level,
        ),
    )


def _humanize_identifier(value: str) -> str:
    """Convert API identifiers into compact labels for profile answers."""
    return value.replace("_", " ").replace("-", " ").title()


def _entity_type_label(entry: EntryModel) -> str:
    if entry.type == "person":
        return "Person"
    if entry.type == "organization":
        return "Organization"
    return _humanize_identifier(entry.type)


def _format_answer_date(iso: str | None) -> str | None:
    if not iso:
        return None
    parsed = datetime.fromisoformat(iso)
    return parsed.strftime("%b %Y")


def _format_answer_evidence(evidence: ClaimEvidence) -> str:
    source_label = (
        f"{evidence.source_count} {'source' if evidence.source_count == 1 else 'sources'}"
    )
    return " · ".join(
        part
        for part in [source_label, evidence.confidence, _format_answer_date(evidence.as_of)]
        if part
    )


def _profile_answers(
    *,
    entry: EntryModel,
    context: EntityRecordContext,
    claim_evidence: ClaimEvidenceSet,
) -> ProfileAnswers:
    """Build the scan-friendly actor summary used by app and agent clients."""
    issue_labels = [_humanize_identifier(slug) for slug in context.issue_area_ids]
    why_parts = [
        f"{context.source_count} {'source' if context.source_count == 1 else 'sources'}",
        *issue_labels[:2],
    ]
    return ProfileAnswers(
        who=_entity_type_label(entry),
        what_they_do=entry.description or ", ".join(issue_labels) or "Public civic actor",
        where=_format_place(entry.city, entry.state, entry.region) or "Location not specified",
        why_they_matter=" · ".join(why_parts),
        how_atlas_knows=_format_answer_evidence(claim_evidence.summary),
    )


def _entity_record(entry: EntryModel, context: EntityRecordContext) -> dict[str, Any]:
    if entry.claim_status == "verified":
        verification_level = "subject-verified"
    elif entry.verified:
        verification_level = "atlas-verified"
    else:
        verification_level = "source-derived"
    claim_evidence = _claim_evidence_set(
        entry=entry,
        context=context,
        verification_level=verification_level,
    )
    return EntityResponse(
        id=entry.id,
        name=entry.name,
        type=entry.type,
        description=entry.description,
        custom_bio=entry.custom_bio,
        photo_url=entry.photo_url,
        address={
            "city": entry.city,
            "state": entry.state,
            "region": entry.region,
            "full_address": entry.full_address,
            "geo_specificity": entry.geo_specificity,
            "display": _format_place(entry.city, entry.state, entry.region),
        },
        contact={
            "website": entry.website,
            "email": entry.email,
            "phone": entry.phone,
            "social_media": entry.social_media,
        },
        preferred_contact_channel=entry.preferred_contact_channel,
        affiliated_org_id=entry.affiliated_org_id,
        active=bool(entry.active),
        verified=bool(entry.verified),
        claim={
            "status": entry.claim_status,
            "claimed_by_user_id": entry.claimed_by_user_id,
            "claim_verified_at": entry.claim_verified_at,
            "verification_level": verification_level,
        },
        claim_evidence=claim_evidence,
        profile_answers=_profile_answers(
            entry=entry,
            context=context,
            claim_evidence=claim_evidence,
        ),
        actor_quality=actor_quality(
            entry,
            issue_area_ids=context.issue_area_ids,
            source_count=context.source_count,
        ),
        trust=TrustInfo(
            level=_trust_level(
                entry=entry, independent_source_count=context.independent_source_count
            ),
            independent_source_count=context.independent_source_count,
            website_grounded=context.website_grounded,
            email_grounded=context.email_grounded,
        ),
        issue_area_ids=context.issue_area_ids,
        source_types=context.source_types,
        source_count=context.source_count,
        freshness=_entity_freshness(entry=entry, latest_source_date=context.latest_source_date),
        flag_summary=FlagSummary.model_validate(context.flag_summary or {}),
        slug=entry.slug,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
        resource_uri=f"atlas://entities/{entry.id}",
    ).model_dump(mode="json")


def _discovery_run_record(run: DiscoveryRunModel) -> dict[str, Any]:
    """Serialize a discovery run with a stable Atlas resource URI for agents."""
    record = DiscoveryRunResponse(
        id=run.id,
        location_query=run.location_query,
        state=run.state,
        research_goal=run.research_goal,
        issue_areas=run.issue_areas,
        queries_generated=run.queries_generated,
        sources_fetched=run.sources_fetched,
        sources_processed=run.sources_processed,
        entries_extracted=run.entries_extracted,
        entries_after_dedup=run.entries_after_dedup,
        entries_confirmed=run.entries_confirmed,
        started_at=run.started_at,
        completed_at=run.completed_at,
        status=run.status,
        error_message=run.error_message,
        created_at=run.created_at,
        research_summary=run.research_summary,
    ).model_dump(mode="json")
    record["resource_uri"] = f"atlas://discovery-runs/{run.id}"
    return record


def _source_record(
    source: Mapping[str, Any],
    *,
    linked_entity_ids: list[str],
    linked_entities: list[Mapping[str, Any]] | None = None,
    extraction_context: str | None = None,
    flag_summary: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return SourceResponse(
        id=source["id"],
        url=source["url"],
        title=source.get("title"),
        publication=source.get("publication"),
        type=source.get("type"),
        extraction_method=source.get("extraction_method"),
        linked_entity_ids=linked_entity_ids,
        linked_entities=list(linked_entities or []),
        extraction_context=extraction_context,
        freshness=_source_freshness(source),
        flag_summary=FlagSummary.model_validate(flag_summary or {}),
        resource_uri=f"atlas://sources/{source['id']}",
    ).model_dump(mode="json")


def _source_linked_entity_record(entry: Any) -> dict[str, str | None]:
    """Return the minimal entity summary used on source cards."""
    return {
        "id": entry.id,
        "name": entry.name,
        "type": entry.type,
        "slug": entry.slug,
    }


async def _source_linked_entities_by_id(
    conn: Any,
    entity_ids: Sequence[str],
) -> dict[str, dict[str, str | None]]:
    """Fetch minimal linked entity summaries keyed by entity id."""
    ordered_ids = list(dict.fromkeys(entity_ids))
    if not ordered_ids:
        return {}

    placeholders = ", ".join("?" for _ in ordered_ids)
    cursor = await conn.execute(
        f"""
        SELECT id, name, type, slug
        FROM entries
        WHERE id IN ({placeholders})
        """,
        ordered_ids,
    )
    rows = _rows_to_dicts(cursor, await cursor.fetchall())
    return {
        str(row["id"]): {
            "id": str(row["id"]),
            "name": str(row["name"]),
            "type": str(row["type"]),
            "slug": str(row["slug"]) if row["slug"] is not None else None,
        }
        for row in rows
    }


def _latest_source_date(sources: Sequence[Mapping[str, Any]], fallback: str) -> str:
    for source in sources:
        published_date = source.get("published_date")
        if published_date:
            return str(published_date)
        ingested_at = source.get("ingested_at")
        if ingested_at:
            return str(ingested_at)[:10]
    return fallback


def _entity_freshness(*, entry: EntryModel, latest_source_date: str | None) -> FreshnessInfo:
    reference = (
        (entry.last_confirmed_at[:10] if entry.last_confirmed_at else None)
        or (entry.last_verified.isoformat() if entry.last_verified else None)
        or latest_source_date
        or entry.last_seen.isoformat()
        or entry.updated_at
    )
    status, reason = _staleness(reference, "entity data")
    return FreshnessInfo(
        updated_at=entry.updated_at,
        created_at=entry.created_at,
        last_seen=entry.last_seen.isoformat(),
        last_verified=entry.last_verified.isoformat() if entry.last_verified else None,
        latest_source_date=latest_source_date,
        staleness_status=status,
        staleness_reason=reason,
    )


def _source_freshness(source: Mapping[str, Any]) -> FreshnessInfo:
    reference = (
        source.get("published_date") or source.get("ingested_at") or source.get("created_at")
    )
    status, reason = _staleness(str(reference) if reference else None, "source record")
    return FreshnessInfo(
        created_at=_string_or_none(source.get("created_at")),
        published_date=_string_or_none(source.get("published_date")),
        ingested_at=_string_or_none(source.get("ingested_at")),
        staleness_status=status,
        staleness_reason=reason,
    )


def _staleness(reference: str | None, label: str) -> tuple[str, str]:
    reference_date = _coerce_date(reference)
    if reference_date is None:
        return "unknown", f"No date available for {label} freshness."
    age_days = (datetime.now(UTC).date() - reference_date).days
    if age_days <= FRESHNESS_DAYS:
        return "fresh", f"Most recent {label} date is within the last {FRESHNESS_DAYS} days."
    if age_days <= AGING_DAYS:
        return "aging", f"Most recent {label} date is more than {FRESHNESS_DAYS} days old."
    return "stale", f"Most recent {label} date is more than a year old."


def _coerce_date(value: str | None) -> date | None:
    if value is None:
        return None
    cleaned = value[:10]
    try:
        return date.fromisoformat(cleaned)
    except ValueError:
        return None


def _string_or_none(value: object | None) -> str | None:
    return None if value is None else str(value)


def _rows_to_dicts(cursor: Any, rows: Iterable[Any]) -> list[dict[str, Any]]:
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row, strict=False)) for row in rows]


def _relationship_ids(entity_id: str, entry: EntryModel, issue_area_ids: list[str]) -> list[str]:
    relationship_ids = [
        f"atlas://entities/{entity_id}/relationships/shared_issue_area/{issue_area_id}"
        for issue_area_id in issue_area_ids
    ]
    if entry.affiliated_org_id:
        relationship_ids.append(
            f"atlas://entities/{entity_id}/relationships/affiliated_organization/{entry.affiliated_org_id}"
        )
    return relationship_ids


def _place_resource_slug(place: Mapping[str, str | None]) -> str:
    if place.get("city") is None and place.get("state") is not None:
        return str(place["state"]).lower()
    parts = [part for part in [place.get("city"), place.get("state"), place.get("region")] if part]
    return "-".join(str(part).lower().replace(" ", "-") for part in parts)


def _place_resource_uri(place: Mapping[str, str | None], suffix: str) -> str:
    """Build a resource URI using atlas://states/ or atlas://cities/ as appropriate."""
    if place.get("city") is None and place.get("state") is not None:
        return f"atlas://states/{str(place['state']).upper()}/{suffix}"
    slug = _place_resource_slug(place)
    return f"atlas://cities/{slug}/{suffix}"


def _tokenize(text: str) -> list[str]:
    return _WORD_RE.findall(text.lower())


def _normalize_state(state: str | None) -> str | None:
    if state is None:
        return None
    cleaned = state.strip().lower()
    if not cleaned:
        return None
    if len(cleaned) == PLACE_KEY_STATE_PARTS:
        return cleaned.upper()
    return _STATE_NAMES.get(cleaned)


def _entity_not_found(entity_id: str) -> ValueError:
    return ValueError(f"Entity not found: {entity_id}")


def _discovery_run_not_found(run_id: str) -> ValueError:
    return ValueError(f"Discovery run not found: {run_id}")


def _invalid_issue_areas(invalid: list[str]) -> ValueError:
    return ValueError(f"Invalid issue area(s): {', '.join(sorted(invalid))}")


def _place_profile_not_found(place_display: str) -> ValueError:
    return ValueError(f"Place profile not found: {place_display}")


def _place_page_context_not_found(place_key: str) -> ValueError:
    return ValueError(f"Place page context not found: {place_key}")


def _unsupported_place_key(place_key: str) -> ValueError:
    return ValueError(f"Unsupported place key: {place_key}")


def _clean_string(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _format_place(city: str | None, state: str | None, region: str | None) -> str | None:
    if city and state:
        return f"{city}, {state}"
    if city:
        return city
    if region:
        return region
    return state


def _decode_cursor(cursor: str | None) -> int:
    if cursor is None:
        return 0
    return max(int(cursor), 0)
