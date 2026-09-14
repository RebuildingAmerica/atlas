"""Store what resolution decided: entries, identity keys, dated roles and holds.

Organizations are stored before people because a person resolves only inside
the organization that named them. Each person's role is written as a
relationship from the person to that organization, dated by the return, so a
profile's connections show where the person serves and since when.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime, time
from typing import TYPE_CHECKING

from atlas.domains.catalog.geo import geocode_entry
from atlas.domains.catalog.models.relationships import RelationshipCRUD
from atlas.domains.discovery.pipeline.runner_storage_persistence import (
    _persist_issue_areas,
    upsert_page_source,
)
from atlas.domains.discovery.resolution.resolver import match_organization, match_person
from atlas.domains.discovery.trust_gate import PUBLISH, evaluate_resolved_person
from atlas.domains.moderation.review_queue import ReviewQueueCRUD
from atlas.models import EntryCRUD, SourceCRUD

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import date

    from aiosqlite import Connection

    from atlas.domains.catalog.models.entry import EntryModel
    from atlas.domains.discovery.resolution.mentions import OrganizationMention, PersonMention
    from atlas.domains.discovery.trust_gate import GateDecision

__all__ = ["ResolutionSummary", "persist_resolved_mentions"]

logger = logging.getLogger(__name__)

# A return is the filer's own sworn statement, but Atlas reads it through a
# third-party index, so a role it evidences stops short of full confidence.
_FILING_ROLE_CONFIDENCE = 0.95


@dataclass
class ResolutionSummary:
    """What persisting a run's resolved mentions produced."""

    entry_ids: list[str] = field(default_factory=list)
    published: int = 0
    held: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class _NewEntry:
    """The fields a resolved mention supplies for a record Atlas does not hold."""

    entry_type: str
    name: str
    description: str
    city: str | None
    state: str | None
    website: str | None


async def persist_resolved_mentions(
    conn: Connection,
    *,
    organizations: Sequence[OrganizationMention],
    people: Sequence[PersonMention],
    issue_areas: Sequence[str],
    today: date,
) -> ResolutionSummary:
    """Resolve and store a run's register organizations and the people they name.

    Parameters
    ----------
    conn : Connection
        Database connection.
    organizations : Sequence[OrganizationMention]
        Register rows, each naming one EIN.
    people : Sequence[PersonMention]
        People named on those organizations' returns.
    issue_areas : Sequence[str]
        Issue areas from the run's schedule.
    today : date
        The date the run read its sources.

    Returns
    -------
    ResolutionSummary
        Entry ids touched, and how many published or were held and why.
    """
    summary = ResolutionSummary()
    organization_ids: dict[str, str] = {}
    for organization in organizations:
        entry_id = await _store_organization(conn, organization, issue_areas, today, summary)
        organization_ids[organization.ein] = entry_id
    for person in people:
        await _store_person(
            conn, person, organization_ids[person.organization.ein], issue_areas, today, summary
        )
    logger.info(
        "Resolved mentions persisted",
        extra={
            "organizations": len(organizations),
            "people": len(people),
            "published": summary.published,
            "held": summary.held,
        },
    )
    return summary


async def _store_organization(
    conn: Connection,
    mention: OrganizationMention,
    issue_areas: Sequence[str],
    today: date,
    summary: ResolutionSummary,
) -> str:
    """Resolve one register row, then key it by EIN and cite the register."""
    source_id = await upsert_page_source(conn, mention.source)
    existing = await match_organization(conn, mention)
    fields = _NewEntry(
        "organization", mention.name, mention.context, mention.city, mention.state, mention.website
    )
    entry_id = await _store_entry(conn, existing, fields, PUBLISH, today, summary)
    await RelationshipCRUD.upsert_identity_key(
        conn,
        entry_id=entry_id,
        key_type="ein",
        key_value=mention.ein,
        source_id=source_id,
        confidence=1.0,
    )
    await SourceCRUD.link_to_entry(conn, entry_id, source_id, extraction_context=mention.context)
    await _persist_issue_areas(conn, entry_id, list(issue_areas))
    return entry_id


async def _store_person(  # noqa: PLR0913
    conn: Connection,
    mention: PersonMention,
    organization_id: str,
    issue_areas: Sequence[str],
    today: date,
    summary: ResolutionSummary,
) -> None:
    """Resolve one person inside their organization, then record their role."""
    source_id = await upsert_page_source(conn, mention.source)
    match = await match_person(conn, mention, organization_id=organization_id)
    decision = evaluate_resolved_person(
        type_conflict=mention.type_conflict,
        identity_ambiguous=match.ambiguous,
        current_role=mention.role.current,
    )
    organization = mention.organization
    fields = _NewEntry(
        "person", mention.display_name, mention.context, organization.city, organization.state, None
    )
    entry_id = await _store_entry(conn, match.entry, fields, decision, today, summary)
    await SourceCRUD.link_to_entry(conn, entry_id, source_id, extraction_context=mention.context)
    await _persist_issue_areas(conn, entry_id, list(issue_areas))
    role = mention.role
    await RelationshipCRUD.upsert_edge(
        conn,
        source_entry_id=entry_id,
        target_entry_id=organization_id,
        relationship_type=role.relationship_type,
        source_id=source_id,
        evidence_label=role.evidence_label,
        confidence=_FILING_ROLE_CONFIDENCE,
        observed_at=(
            datetime.combine(role.observed_on, time(), UTC).isoformat()
            if role.observed_on
            else None
        ),
    )


async def _store_entry(  # noqa: PLR0913
    conn: Connection,
    existing: EntryModel | None,
    fields: _NewEntry,
    decision: GateDecision,
    today: date,
    summary: ResolutionSummary,
) -> str:
    """Create or refresh an entry, then apply the gate's decision to it."""
    if existing is None:
        located = await geocode_entry(fields.city, fields.state, None, allow_remote=False)
        entry_id = str(
            await EntryCRUD.create(
                conn,
                entry_type=fields.entry_type,
                name=fields.name,
                description=fields.description,
                city=fields.city,
                state=fields.state,
                geo_specificity="local",
                latitude=located.latitude if located else None,
                longitude=located.longitude if located else None,
                geocode_precision=located.precision if located else None,
                geocode_source=located.source if located else None,
                website=fields.website,
                first_seen=today,
                last_seen=today,
                active=False,
            )
        )
    else:
        entry_id = existing.id
        await EntryCRUD.update(
            conn,
            entry_id,
            # A person's filing is the only source of their name and role, so
            # the newest return's wording replaces the old. An organization
            # keeps a description a curator or a richer source already wrote.
            name=fields.name if fields.entry_type == "person" else existing.name,
            description=(
                fields.description
                if fields.entry_type == "person" or not existing.description
                else existing.description
            ),
            website=existing.website or fields.website,
            last_seen=today,
        )
    summary.entry_ids.append(entry_id)
    await _apply_decision(conn, entry_id, fields.entry_type, decision, summary)
    return entry_id


async def _apply_decision(
    conn: Connection,
    entry_id: str,
    kind: str,
    decision: GateDecision,
    summary: ResolutionSummary,
) -> None:
    """Publish an entry or queue its hold, without overruling a curator.

    A hold never unpublishes. An entry that is public today and newly held,
    such as an officer the newest return marks as former, goes to review
    rather than disappearing on an automated judgment.
    """
    if decision.hold_reason is None:
        if await ReviewQueueCRUD.release_resolved(conn, entity_id=entry_id):
            summary.published += 1
        return
    await ReviewQueueCRUD.hold_for_resolution(
        conn, entity_id=entry_id, kind=kind, hold_reason=decision.hold_reason
    )
    summary.held[decision.hold_reason] = summary.held.get(decision.hold_reason, 0) + 1
