"""Firehose row coercion helpers."""

from __future__ import annotations

from typing import Any, cast

from atlas.platform.database import db

from .model_records_types import (
    FirehoseArtifactModel,
    FirehoseObservationDeliveryModel,
    FirehoseObservationDeliveryStatus,
    FirehoseObservationModel,
    FirehoseObservationProducer,
    FirehoseObservationStatus,
    FirehoseRouteDestinationType,
    FirehoseRouteModel,
    FirehoseRouteState,
    FirehoseSourceKind,
    FirehoseSourceOrigin,
    FirehoseSourcePriority,
    FirehoseSourceSafetyPolicy,
    FirehoseSourceTargetModel,
)


def decode_string_list(value: str) -> list[str]:
    """Decode a JSON string list, returning an empty list for malformed values."""
    decoded = db.decode_json(value)
    if isinstance(decoded, list) and all(isinstance(item, str) for item in decoded):
        return decoded
    return []


def row_dict(cursor: Any, row: Any) -> dict[str, Any]:
    """Return a dictionary for a DB row using cursor descriptions."""
    columns = [column[0] for column in cursor.description]
    return dict(zip(columns, row, strict=False))


def source_target_from_row(row: dict[str, Any]) -> FirehoseSourceTargetModel:
    """Build a source target model from a database row."""
    return FirehoseSourceTargetModel(
        id=str(row["id"]),
        org_id=str(row["org_id"]),
        coverage_target_id=str(row["coverage_target_id"]),
        label=str(row["label"]),
        url=str(row["url"]),
        source_kind=cast("FirehoseSourceKind", row["source_kind"]),
        source_class=str(row["source_class"]),
        places=decode_string_list(str(row["places_json"])),
        issues=decode_string_list(str(row["issues_json"])),
        priority=cast("FirehoseSourcePriority", row["priority"]),
        cadence_seconds=int(row["cadence_seconds"]),
        enabled=bool(row["enabled"]),
        safety_policy=cast("FirehoseSourceSafetyPolicy", row["safety_policy"]),
        public_route_enabled=bool(row["public_route_enabled"]),
        origin=cast("FirehoseSourceOrigin", row["origin"]),
        origin_note=row["origin_note"],
        last_checked_at=row["last_checked_at"],
        last_success_at=row["last_success_at"],
        last_error=row["last_error"],
        last_http_status=row["last_http_status"],
        etag=row["etag"],
        last_modified=row["last_modified"],
        content_hash=row["content_hash"],
        created_by=str(row["created_by"]),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def artifact_from_row(row: dict[str, Any]) -> FirehoseArtifactModel:
    """Build an artifact model from a database row."""
    return FirehoseArtifactModel(
        id=str(row["id"]),
        source_target_id=str(row["source_target_id"]),
        org_id=str(row["org_id"]),
        coverage_target_id=str(row["coverage_target_id"]),
        source_url=str(row["source_url"]),
        canonical_url=str(row["canonical_url"]),
        title=str(row["title"]),
        publisher=row["publisher"],
        source_kind=cast("FirehoseSourceKind", row["source_kind"]),
        source_class=str(row["source_class"]),
        published_at=row["published_at"],
        detected_at=str(row["detected_at"]),
        fetched_at=str(row["fetched_at"]),
        content_hash=str(row["content_hash"]),
        fingerprint=str(row["fingerprint"]),
        relevant_text=str(row["relevant_text"]),
        raw_content=row["raw_content"],
        http_status=row["http_status"],
        metadata_json=str(row["metadata_json"]),
    )


def observation_from_row(row: dict[str, Any]) -> FirehoseObservationModel:
    """Build an observation model from a database row."""
    return FirehoseObservationModel(
        id=str(row["id"]),
        producer=cast("FirehoseObservationProducer", row["producer"]),
        observation_type=str(row["observation_type"]),
        subject_type=str(row["subject_type"]),
        subject_id=row["subject_id"],
        org_id=row["org_id"],
        coverage_target_id=row["coverage_target_id"],
        places=decode_string_list(str(row["places_json"])),
        issues=decode_string_list(str(row["issues_json"])),
        source_class=row["source_class"],
        occurred_at=row["occurred_at"],
        observed_at=str(row["observed_at"]),
        dedupe_key=str(row["dedupe_key"]),
        public_realm_basis=str(row["public_realm_basis"]),
        confidence=float(row["confidence"]),
        sensitivity=float(row["sensitivity"]),
        payload_json=str(row["payload_json"]),
        evidence_json=str(row["evidence_json"]),
        status=cast("FirehoseObservationStatus", row["status"]),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def observation_delivery_from_row(row: dict[str, Any]) -> FirehoseObservationDeliveryModel:
    """Build an observation delivery model from a database row."""
    return FirehoseObservationDeliveryModel(
        id=str(row["id"]),
        observation_id=str(row["observation_id"]),
        status=cast("FirehoseObservationDeliveryStatus", row["status"]),
        attempts=int(row["attempts"]),
        claimed_by=row["claimed_by"],
        claimed_until=row["claimed_until"],
        next_attempt_at=str(row["next_attempt_at"]),
        last_error=row["last_error"],
        delivered_at=row["delivered_at"],
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def route_from_row(row: dict[str, Any]) -> FirehoseRouteModel:
    """Build a route model from a database row."""
    return FirehoseRouteModel(
        id=str(row["id"]),
        signal_id=str(row["signal_id"]),
        destination_type=cast("FirehoseRouteDestinationType", row["destination_type"]),
        destination_id=row["destination_id"],
        state=cast("FirehoseRouteState", row["state"]),
        route_reason=str(row["route_reason"]),
        routed_at=str(row["routed_at"]),
    )
