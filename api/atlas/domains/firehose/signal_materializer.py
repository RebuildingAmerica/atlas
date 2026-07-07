"""Create Firehose signals from stored civic observations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, cast

from atlas.domains.access.models.watch_events import OrgChangeEventCRUD, OrgChangeEventRecord
from atlas.platform.database import db

from .model_observations import FirehoseObservationCRUD, link_signal_observation
from .model_records import FirehoseObservationModel, FirehoseSignalCreate
from .model_routes import FirehoseRouteCRUD
from .model_signals import FirehoseSignalCRUD
from .models import FirehoseRouteCreate

if TYPE_CHECKING:
    import aiosqlite


UNKNOWN_OBSERVATION_MESSAGE = "Unknown Firehose observation."
WATCH_DIGEST_SENSITIVITY_THRESHOLD = 0.5


@dataclass(slots=True)
class FirehoseSignalMaterializationResult:
    """Summary of signal resources created for an observation."""

    observation_id: str
    routes_created: int
    signals_created: int
    unchanged: bool


def _payload(observation: FirehoseObservationModel) -> dict[str, object]:
    decoded = db.decode_json(observation.payload_json)
    return decoded if isinstance(decoded, dict) else {}


def _signal_type(observation: FirehoseObservationModel, payload: dict[str, object]) -> str:
    if observation.observation_type == "watched_source_artifact":
        provided = payload.get("signal_type")
        if isinstance(provided, str) and provided:
            return provided
        return "new_source"
    return observation.observation_type


def _signal_key(observation: FirehoseObservationModel, signal_type: str) -> str:
    subject = observation.subject_id or observation.id
    return f"{observation.producer}:{observation.dedupe_key}:{subject}:{signal_type}"


def _title(observation: FirehoseObservationModel, payload: dict[str, object]) -> str:
    title = payload.get("title")
    if isinstance(title, str) and title:
        return title
    return observation.observation_type.replace("_", " ").title()


def _summary(observation: FirehoseObservationModel, payload: dict[str, object]) -> str:
    summary = payload.get("summary")
    if isinstance(summary, str) and summary:
        return summary
    return _title(observation, payload)


def _artifact_id(payload: dict[str, object]) -> str | None:
    artifact_id = payload.get("artifact_id")
    return artifact_id if isinstance(artifact_id, str) and artifact_id else None


def _visibility(payload: dict[str, object]) -> str:
    visibility = payload.get("visibility")
    return visibility if isinstance(visibility, str) and visibility else "workspace"


def _review_state(payload: dict[str, object]) -> str:
    review_state = payload.get("review_state")
    return review_state if isinstance(review_state, str) and review_state else "not_required"


async def _signal_id_for_key(
    conn: aiosqlite.Connection,
    *,
    org_id: str,
    signal_key: str,
) -> str | None:
    cursor = await conn.execute(
        "SELECT id FROM firehose_signals WHERE org_id = ? AND signal_key = ?",
        (org_id, signal_key),
    )
    row = await cursor.fetchone()
    return str(row[0]) if row is not None else None


async def _route_signal(
    conn: aiosqlite.Connection,
    *,
    observation: FirehoseObservationModel,
    payload: dict[str, object],
    signal_id: str,
) -> int:
    if observation.coverage_target_id is None:
        return 0

    created = 0
    await FirehoseRouteCRUD.create(
        conn,
        FirehoseRouteCreate(
            signal_id=signal_id,
            destination_type="workspace",
            destination_id=observation.coverage_target_id,
            state="active",
            route_reason="Matches observed civic field",
        ),
    )
    created += 1

    if payload.get("public_route_enabled") is True:
        await FirehoseRouteCRUD.create(
            conn,
            FirehoseRouteCreate(
                signal_id=signal_id,
                destination_type="public",
                destination_id=None,
                state="active",
                route_reason="Observation approved for public Firehose",
            ),
        )
        created += 1

    return created


async def _workspace_watches_coverage_target(
    conn: aiosqlite.Connection,
    *,
    org_id: str,
    coverage_target_id: str,
) -> bool:
    cursor = await conn.execute(
        """
        SELECT 1
        FROM org_watches
        WHERE org_id = ?
          AND resource_type = 'coverage_target'
          AND resource_id = ?
          AND notification_preference <> 'muted'
        LIMIT 1
        """,
        (org_id, coverage_target_id),
    )
    return await cursor.fetchone() is not None


async def _civic_signal_event_exists(
    conn: aiosqlite.Connection,
    *,
    org_id: str,
    coverage_target_id: str,
    signal_id: str,
) -> bool:
    cursor = await conn.execute(
        """
        SELECT metadata_json
        FROM org_change_events
        WHERE org_id = ?
          AND resource_type = 'coverage_target'
          AND resource_id = ?
          AND event_type = 'civic_signal'
        """,
        (org_id, coverage_target_id),
    )
    rows = await cursor.fetchall()
    for row in rows:
        metadata = db.decode_json(str(row[0]))
        if isinstance(metadata, dict) and metadata.get("firehose_signal_id") == signal_id:
            return True
    return False


def _is_digest_safe_signal(
    observation: FirehoseObservationModel,
    *,
    review_state: str,
    visibility: str,
) -> bool:
    return (
        observation.coverage_target_id is not None
        and observation.org_id is not None
        and visibility == "workspace"
        and review_state in {"not_required", "approved"}
        and observation.sensitivity < WATCH_DIGEST_SENSITIVITY_THRESHOLD
    )


async def _route_watch_digest_event(  # noqa: PLR0913
    conn: aiosqlite.Connection,
    *,
    observation: FirehoseObservationModel,
    signal_id: str,
    signal_type: str,
    title: str,
    summary: str,
    review_state: str,
    visibility: str,
) -> bool:
    if not _is_digest_safe_signal(observation, review_state=review_state, visibility=visibility):
        return False

    assert observation.org_id is not None
    assert observation.coverage_target_id is not None
    if not await _workspace_watches_coverage_target(
        conn,
        org_id=observation.org_id,
        coverage_target_id=observation.coverage_target_id,
    ):
        return False

    if await _civic_signal_event_exists(
        conn,
        org_id=observation.org_id,
        coverage_target_id=observation.coverage_target_id,
        signal_id=signal_id,
    ):
        return False

    await OrgChangeEventCRUD.record(
        conn,
        OrgChangeEventRecord(
            org_id=observation.org_id,
            resource_type="coverage_target",
            resource_id=observation.coverage_target_id,
            event_type="civic_signal",
            title=title,
            summary=summary,
            coverage_target_id=observation.coverage_target_id,
            metadata_json=db.encode_json(
                {
                    "firehose_observation_id": observation.id,
                    "firehose_signal_id": signal_id,
                    "firehose_signal_type": signal_type,
                    "confidence": observation.confidence,
                    "sensitivity": observation.sensitivity,
                }
            ),
        ),
    )
    return True


async def create_signals_for_observation(
    conn: aiosqlite.Connection,
    *,
    observation_id: str,
) -> FirehoseSignalMaterializationResult:
    """Create idempotent user-facing signals for one stored observation."""
    observation = await FirehoseObservationCRUD.get_by_id(conn, observation_id)
    if observation is None:
        raise ValueError(UNKNOWN_OBSERVATION_MESSAGE)
    if observation.org_id is None:
        return FirehoseSignalMaterializationResult(
            observation_id=observation_id,
            routes_created=0,
            signals_created=0,
            unchanged=True,
        )

    payload = _payload(observation)
    signal_type = _signal_type(observation, payload)
    signal_key = _signal_key(observation, signal_type)
    title = _title(observation, payload)
    summary = _summary(observation, payload)
    review_state = _review_state(payload)
    visibility = _visibility(payload)
    existing_signal_id = await _signal_id_for_key(
        conn,
        org_id=observation.org_id,
        signal_key=signal_key,
    )
    if existing_signal_id is not None:
        return FirehoseSignalMaterializationResult(
            observation_id=observation_id,
            routes_created=0,
            signals_created=0,
            unchanged=True,
        )

    signal = await FirehoseSignalCRUD.create(
        conn,
        FirehoseSignalCreate(
            artifact_id=_artifact_id(payload),
            org_id=observation.org_id,
            coverage_target_id=observation.coverage_target_id,
            signal_type=signal_type,
            title=title,
            summary=summary,
            occurred_at=observation.occurred_at,
            detected_at=observation.observed_at,
            public_realm_basis=observation.public_realm_basis,
            places=observation.places,
            issues=observation.issues,
            actors=cast("list[dict[str, object]]", payload.get("actors") or []),
            confidence=observation.confidence,
            sensitivity=observation.sensitivity,
            review_state=review_state,
            visibility=visibility,
            route_state="routed",
            primary_observation_id=observation.id,
            signal_key=signal_key,
        ),
    )
    await link_signal_observation(
        conn,
        signal_id=signal.id,
        observation_id=observation.id,
        role="primary",
    )
    routes_created = await _route_signal(
        conn,
        observation=observation,
        payload=payload,
        signal_id=signal.id,
    )
    await _route_watch_digest_event(
        conn,
        observation=observation,
        signal_id=signal.id,
        signal_type=signal_type,
        title=title,
        summary=summary,
        review_state=review_state,
        visibility=visibility,
    )
    await FirehoseObservationCRUD.mark_signals_created(conn, observation.id)
    return FirehoseSignalMaterializationResult(
        observation_id=observation.id,
        routes_created=routes_created,
        signals_created=1,
        unchanged=False,
    )
