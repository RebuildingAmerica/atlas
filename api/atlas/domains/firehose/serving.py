"""Stored Firehose signal serving helpers."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, cast

from .models import FirehoseSignalCRUD, FirehoseSignalModel, FirehoseSignalQuery
from .schemas import (
    FirehoseActorRef,
    FirehoseDestination,
    FirehoseEvidence,
    FirehoseQuery,
    FirehoseReviewState,
    FirehoseSignal,
    FirehoseSignalType,
    FirehoseSummary,
    FirehoseVisibility,
)

if TYPE_CHECKING:
    import aiosqlite


def _actor_refs(signal: FirehoseSignalModel) -> list[FirehoseActorRef]:
    decoded = json.loads(signal.actors_json)
    if not isinstance(decoded, list):
        return []
    return [FirehoseActorRef.model_validate(item) for item in decoded if isinstance(item, dict)]


def _signal_response(signal: FirehoseSignalModel) -> FirehoseSignal:
    return FirehoseSignal(
        id=signal.id,
        type=cast("FirehoseSignalType", signal.type),
        title=signal.title,
        summary=signal.summary,
        occurred_at=signal.occurred_at,
        detected_at=signal.detected_at,
        public_realm_basis=signal.public_realm_basis,
        places=signal.places,
        issues=signal.issues,
        actors=_actor_refs(signal),
        confidence=signal.confidence,
        sensitivity=signal.sensitivity,
        review_state=cast("FirehoseReviewState", signal.review_state),
        visibility=cast("FirehoseVisibility", signal.visibility),
        evidence=[
            FirehoseEvidence(
                source_url=evidence.source_url,
                title=evidence.title,
                publisher=evidence.publisher,
                published_at=evidence.published_at,
                captured_at=evidence.captured_at,
                passage=evidence.passage,
                locator=evidence.locator,
                content_hash=evidence.content_hash,
            )
            for evidence in signal.evidence
        ],
        destinations=[
            FirehoseDestination(
                type=destination.type,
                id=destination.id,
                state=destination.state,
            )
            for destination in signal.destinations
        ],
    )


def signal_summary(signals: list[FirehoseSignal]) -> FirehoseSummary:
    """Return summary counts for a stored signal list."""
    return FirehoseSummary(
        total_signals=len(signals),
        visible_signals=sum(1 for signal in signals if signal.review_state != "held"),
        held_signals=sum(1 for signal in signals if signal.review_state == "held"),
        latest_cursor=signals[0].detected_at if signals else None,
    )


async def list_stored_signals(
    conn: aiosqlite.Connection,
    *,
    org_id: str | None,
    query: FirehoseQuery,
) -> list[FirehoseSignal]:
    """Return stored Firehose signals in the API response shape."""
    stored = await FirehoseSignalCRUD.list_for_query(
        conn,
        FirehoseSignalQuery(
            org_id=org_id,
            places=query.places,
            issues=query.issues,
            signal_types=list(query.signal_types),
            source_classes=query.source_classes,
            visibility=query.visibility,
            limit=query.limit,
        ),
    )
    return [_signal_response(signal) for signal in stored]
