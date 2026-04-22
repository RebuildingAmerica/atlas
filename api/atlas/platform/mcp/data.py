"""Place-first Atlas data service for MCP tools and public APIs."""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Any, TypedDict, Unpack

from atlas.domains.catalog.place_profiles import PLACE_PROFILES
from atlas.domains.catalog.schemas.public import (
    Address,
    CoverageCount,
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
    PlaceProfileResponse,
    PlaceTypeCount,
    SourceCollectionResponse,
    SourceResponse,
)
from atlas.domains.catalog.taxonomy import (
    DOMAINS,
    ISSUE_AREAS_BY_DOMAIN,
    ISSUE_SEARCH_TERMS,
    get_issue_area_by_slug,
)
from atlas.models import EntryCRUD, FlagCRUD, get_db_connection

__all__ = ["AtlasDataService"]

if TYPE_CHECKING:
    from aiosqlite import Connection

    from atlas.domains.catalog.models.entry import EntryModel

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

    def __init__(
        self,
        *,
        issue_area_ids: list[str],
        source_types: list[str],
        source_count: int,
        latest_source_date: str | None,
        flag_summary: Mapping[str, Any] | None = None,
    ) -> None:
        self.issue_area_ids = issue_area_ids
        self.source_types = source_types
        self.source_count = source_count
        self.latest_source_date = latest_source_date
        self.flag_summary = flag_summary


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

    async def get_entity(self, entity_id: str) -> dict[str, Any]:
        """Get one Atlas entity."""
        async with DatabaseSession(self._database_url) as conn:
            entry, sources = await EntryCRUD.get_with_sources(conn, entity_id)
            if entry is None:
                raise _entity_not_found(entity_id)
            issue_area_ids = await EntryCRUD.get_issue_areas(conn, entity_id)
            entity_flag_summaries = await FlagCRUD.entity_flag_summaries(conn, [entity_id])
            source_flag_summaries = await FlagCRUD.source_flag_summaries(
                conn, [source["id"] for source in sources]
            )

        source_records = [
            _source_record(
                source,
                linked_entity_ids=[entity_id],
                extraction_context=source["extraction_context"],
                flag_summary=source_flag_summaries.get(source["id"]),
            )
            for source in sources
        ]
        entity = _entity_record(
            entry,
            EntityRecordContext(
                issue_area_ids=issue_area_ids,
                source_types=sorted({source["type"] for source in sources}),
                source_count=len(sources),
                latest_source_date=_latest_source_date(sources, entry.last_seen.isoformat()),
                flag_summary=entity_flag_summaries.get(entity_id),
            ),
        )
        entity["source_ids"] = [source["id"] for source in sources]
        entity["relationship_ids"] = _relationship_ids(entity_id, entry, issue_area_ids)
        entity["sources"] = source_records
        return EntityDetailResponse.model_validate(entity).model_dump(mode="json")

    async def get_entity_sources(self, entity_id: str) -> dict[str, Any]:
        """Return supporting sources for one entity."""
        async with DatabaseSession(self._database_url) as conn:
            entry, sources = await EntryCRUD.get_with_sources(conn, entity_id)
            if entry is None:
                raise _entity_not_found(entity_id)
            source_flag_summaries = await FlagCRUD.source_flag_summaries(
                conn, [source["id"] for source in sources]
            )

        return EntitySourcesResponse(
            entity_id=entity_id,
            sources=[
                _source_record(
                    source,
                    linked_entity_ids=[entity_id],
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

        items = []
        for row in rows:
            linked_entity_ids = row[9].split(",") if row[9] else []
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


def _entity_record(entry: EntryModel, context: EntityRecordContext) -> dict[str, Any]:
    return EntityResponse(
        id=entry.id,
        name=entry.name,
        type=entry.type,
        description=entry.description,
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
        affiliated_org_id=entry.affiliated_org_id,
        active=bool(entry.active),
        verified=bool(entry.verified),
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


def _source_record(
    source: Mapping[str, Any],
    *,
    linked_entity_ids: list[str],
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
        extraction_context=extraction_context,
        freshness=_source_freshness(source),
        flag_summary=FlagSummary.model_validate(flag_summary or {}),
        resource_uri=f"atlas://sources/{source['id']}",
    ).model_dump(mode="json")


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
        (entry.last_verified.isoformat() if entry.last_verified else None)
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


def _invalid_issue_areas(invalid: list[str]) -> ValueError:
    return ValueError(f"Invalid issue area(s): {', '.join(sorted(invalid))}")


def _place_profile_not_found(place_display: str) -> ValueError:
    return ValueError(f"Place profile not found: {place_display}")


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
