"""Record serializers for the MCP data service."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence  # noqa: TC003
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Any

from atlas.domains.catalog.models.entry import actor_quality
from atlas.domains.catalog.schemas.public import (
    EntityResponse,
    FlagSummary,
    FreshnessInfo,
    SourceResponse,
    TrustInfo,
)
from atlas.models import EntryCRUD
from atlas.platform.mcp.data_parts.context import EntityRecordContext  # noqa: TC001
from atlas.platform.mcp.data_parts.place_utils import _format_place
from atlas.platform.mcp.data_parts.trust import (
    _claim_evidence_set,
    _profile_answers,
    _trust_level,
)
from atlas.schemas import DiscoveryRunResponse

if TYPE_CHECKING:
    from atlas.domains.catalog.models.entry import EntryModel
    from atlas.domains.discovery.models import DiscoveryRunModel

FRESHNESS_DAYS = 180
AGING_DAYS = 365


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
            "linked_atproto_handle": entry.linked_atproto_handle
            if entry.claim_status == "verified"
            else None,
            "linked_atproto_did": entry.linked_atproto_did
            if entry.claim_status == "verified"
            else None,
            "linked_atproto_verified_at": entry.linked_atproto_verified_at
            if entry.claim_status == "verified"
            else None,
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
        profile_url=_profile_url(entry, context),
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


def _source_linked_entity_record(
    entry: Any, *, issue_area_ids: Sequence[str] | None = None
) -> dict[str, Any]:
    """Return the minimal entity summary used on source cards."""
    return {
        "id": entry.id,
        "name": entry.name,
        "type": entry.type,
        "slug": entry.slug,
        "issue_area_ids": list(issue_area_ids or []),
    }


async def _source_linked_entities_by_id(
    conn: Any,
    entity_ids: Sequence[str],
) -> dict[str, dict[str, Any]]:
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
    issue_map = await EntryCRUD.get_issue_areas_for_entries(conn, ordered_ids)
    return {
        str(row["id"]): {
            "id": str(row["id"]),
            "name": str(row["name"]),
            "type": str(row["type"]),
            "slug": str(row["slug"]) if row["slug"] is not None else None,
            "issue_area_ids": issue_map.get(str(row["id"]), []),
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


def _entity_freshness(
    *, entry: EntryModel, latest_source_date: date | datetime | str | None
) -> FreshnessInfo:
    latest_source_date_value = _date_string(latest_source_date)
    reference = (
        (entry.last_confirmed_at[:10] if entry.last_confirmed_at else None)
        or (entry.last_verified.isoformat() if entry.last_verified else None)
        or latest_source_date_value
        or entry.last_seen.isoformat()
        or entry.updated_at
    )
    status, reason = _staleness(reference, "entity data")
    return FreshnessInfo(
        updated_at=entry.updated_at,
        created_at=entry.created_at,
        last_seen=entry.last_seen.isoformat(),
        last_verified=entry.last_verified.isoformat() if entry.last_verified else None,
        latest_source_date=latest_source_date_value,
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


def _staleness(reference: date | datetime | str | None, label: str) -> tuple[str, str]:
    reference_date = _coerce_date(reference)
    if reference_date is None:
        return "unknown", f"No date available for {label} freshness."
    age_days = (datetime.now(UTC).date() - reference_date).days
    if age_days <= FRESHNESS_DAYS:
        return "fresh", f"Most recent {label} date is within the last {FRESHNESS_DAYS} days."
    if age_days <= AGING_DAYS:
        return "aging", f"Most recent {label} date is more than {FRESHNESS_DAYS} days old."
    return "stale", f"Most recent {label} date is more than a year old."


def _coerce_date(value: date | datetime | str | None) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    cleaned = value[:10]
    try:
        return date.fromisoformat(cleaned)
    except ValueError:
        return None


def _string_or_none(value: object | None) -> str | None:
    return None if value is None else str(value)


def _date_string(value: date | datetime | str | None) -> str | None:
    coerced = _coerce_date(value)
    return coerced.isoformat() if coerced is not None else None


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


_PROFILE_ROUTE_SEGMENT_BY_TYPE = {
    "person": "people",
    "organization": "organizations",
}


def _profile_url(entry: EntryModel, context: EntityRecordContext) -> str | None:
    """Build the absolute public profile URL for an entity, when derivable.

    Mirrors the type-to-route-segment convention in the frontend's
    `profileHref()` (`app/src/domains/catalog/components/entries/entry-card.tsx`):
    person -> "people", organization -> "organizations", everything else ->
    the pluralized type.

    Parameters
    ----------
    entry : EntryModel
        The entry being serialized.
    context : EntityRecordContext
        Serialization context, carrying the configured public app origin.

    Returns
    -------
    str | None
        The absolute profile URL, or None when the public origin or slug is
        not available.
    """
    if not context.public_url or not entry.slug:
        return None
    segment = _PROFILE_ROUTE_SEGMENT_BY_TYPE.get(entry.type, f"{entry.type}s")
    return f"{context.public_url.rstrip('/')}/profiles/{segment}/{entry.slug}"
