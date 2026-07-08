"""Record builders for `atlas.platform.mcp.data`."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Any

from atlas.domains.catalog.models.entry import EntryModel, actor_quality
from atlas.domains.catalog.schemas.public import (
    ClaimEvidence,
    ClaimEvidenceSet,
    EntityResponse,
    FlagSummary,
    FreshnessInfo,
    ProfileAnswers,
    SourceResponse,
    TrustInfo,
)
from atlas.models import EntryCRUD
from atlas.schemas import DiscoveryRunResponse

from .data_place_helpers import _format_place
from .data_record_urls import _profile_url
from .data_trust_helpers import (
    _claim_evidence_set,
    _trust_level,
)

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping, Sequence

    from atlas.domains.discovery.models import DiscoveryRunModel

AGING_DAYS = 365
FRESHNESS_DAYS = 180


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
        public_url: str | None = None,
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
        self.public_url = public_url


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
        profile_url=_profile_url(entry, context.public_url),
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


__all__ = [name for name in globals() if not name.startswith("__")]
