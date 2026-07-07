"""Typed Firehose observation producers for Atlas civic domains."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas.platform.database import db

from .models import FirehoseObservationCreate, FirehoseObservationCRUD, FirehoseObservationModel

if TYPE_CHECKING:
    import aiosqlite


async def record_discovery_actor_observation(  # noqa: PLR0913
    conn: aiosqlite.Connection,
    *,
    org_id: str | None,
    run_id: str,
    entry_id: str,
    entry_name: str,
    places: list[str],
    issues: list[str],
    observed_at: str | None = None,
) -> FirehoseObservationModel:
    """Record that discovery or Scout found a source-backed civic actor."""
    return await FirehoseObservationCRUD.create(
        conn,
        FirehoseObservationCreate(
            producer="discovery_sync",
            observation_type="actor_discovered",
            subject_type="entry",
            subject_id=entry_id,
            org_id=org_id,
            coverage_target_id=None,
            places=places,
            issues=issues,
            source_class="discovery_run",
            occurred_at=None,
            observed_at=observed_at or db.now_iso(),
            dedupe_key=f"{run_id}:{entry_id}",
            public_realm_basis="Source-backed Atlas discovery result",
            confidence=0.74,
            sensitivity=0.12,
            payload={
                "summary": f"{entry_name} appeared in an Atlas discovery result.",
                "title": f"New civic actor found: {entry_name}",
            },
            evidence=[],
        ),
    )


async def record_catalog_source_observation(  # noqa: PLR0913
    conn: aiosqlite.Connection,
    *,
    entry_id: str,
    source_id: str,
    source_url: str,
    source_class: str,
    summary: str | None,
    observed_at: str | None = None,
) -> FirehoseObservationModel:
    """Record that a public source was attached to an Atlas catalog entry."""
    resolved_summary = summary or "A public source was attached to an Atlas record."
    return await FirehoseObservationCRUD.create(
        conn,
        FirehoseObservationCreate(
            producer="catalog",
            observation_type="source_attached",
            subject_type="source",
            subject_id=source_id,
            org_id=None,
            coverage_target_id=None,
            places=[],
            issues=[],
            source_class=source_class,
            occurred_at=None,
            observed_at=observed_at or db.now_iso(),
            dedupe_key=f"{entry_id}:{source_id}",
            public_realm_basis="Public source attached to Atlas civic record",
            confidence=0.7,
            sensitivity=0.1,
            payload={
                "entry_id": entry_id,
                "source_id": source_id,
                "summary": resolved_summary,
                "title": "Public source attached",
            },
            evidence=[
                {
                    "captured_at": observed_at or db.now_iso(),
                    "content_hash": "",
                    "locator": None,
                    "passage": resolved_summary,
                    "published_at": None,
                    "publisher": None,
                    "source_class": source_class,
                    "source_url": source_url,
                    "title": None,
                }
            ],
        ),
    )


async def record_catalog_relationship_observation(  # noqa: PLR0913
    conn: aiosqlite.Connection,
    *,
    edge_id: str,
    source_entry_id: str,
    target_entry_id: str,
    relationship_type: str,
    source_id: str,
    evidence_label: str,
    observed_at: str | None = None,
) -> FirehoseObservationModel:
    """Record that Atlas observed a sourced civic relationship."""
    return await FirehoseObservationCRUD.create(
        conn,
        FirehoseObservationCreate(
            producer="catalog",
            observation_type="relationship_observed",
            subject_type="relationship",
            subject_id=edge_id,
            org_id=None,
            coverage_target_id=None,
            places=[],
            issues=[],
            source_class="catalog_source",
            occurred_at=None,
            observed_at=observed_at or db.now_iso(),
            dedupe_key=f"{source_entry_id}:{target_entry_id}:{relationship_type}:{source_id}",
            public_realm_basis="Sourced public relationship attached to Atlas civic graph",
            confidence=0.72,
            sensitivity=0.18,
            payload={
                "relationship_type": relationship_type,
                "source_entry_id": source_entry_id,
                "summary": evidence_label,
                "target_entry_id": target_entry_id,
                "title": "Civic relationship observed",
            },
            evidence=[],
        ),
    )


async def record_profile_claim_observation(
    conn: aiosqlite.Connection,
    *,
    claim_id: str,
    entry_id: str,
    status: str,
    observed_at: str | None = None,
) -> FirehoseObservationModel:
    """Record that a profile stewardship claim changed state."""
    return await FirehoseObservationCRUD.create(
        conn,
        FirehoseObservationCreate(
            producer="profile_claim",
            observation_type="profile_claimed",
            subject_type="profile_claim",
            subject_id=claim_id,
            org_id=None,
            coverage_target_id=None,
            places=[],
            issues=[],
            source_class="profile_claim",
            occurred_at=None,
            observed_at=observed_at or db.now_iso(),
            dedupe_key=f"{claim_id}:{status}",
            public_realm_basis="Public profile stewardship action in Atlas",
            confidence=0.8,
            sensitivity=0.3,
            payload={
                "entry_id": entry_id,
                "status": status,
                "summary": f"Profile claim status changed to {status}.",
                "title": "Profile claim updated",
                "visibility": "reviewer",
            },
            evidence=[],
        ),
    )


async def record_review_decision_observation(
    conn: aiosqlite.Connection,
    *,
    review_item_id: str,
    status: str,
    reviewed_by: str,
    observed_at: str | None = None,
) -> FirehoseObservationModel:
    """Record that a reviewer decided a held civic record."""
    return await FirehoseObservationCRUD.create(
        conn,
        FirehoseObservationCreate(
            producer="review",
            observation_type="review_decision",
            subject_type="review_item",
            subject_id=review_item_id,
            org_id=None,
            coverage_target_id=None,
            places=[],
            issues=[],
            source_class="review_queue",
            occurred_at=None,
            observed_at=observed_at or db.now_iso(),
            dedupe_key=f"{review_item_id}:{status}",
            public_realm_basis="Atlas reviewer decision on source-backed civic record",
            confidence=0.9,
            sensitivity=0.25,
            payload={
                "reviewed_by": reviewed_by,
                "status": status,
                "summary": f"Review item was {status}.",
                "title": "Review decision recorded",
                "visibility": "reviewer",
            },
            evidence=[],
        ),
    )
