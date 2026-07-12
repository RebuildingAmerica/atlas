"""Org-scoped ingestion quality summary endpoints."""

from __future__ import annotations

from collections.abc import AsyncGenerator  # noqa: TC003
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from atlas.domains.access.dependencies import require_org_actor
from atlas.models import get_db_connection
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access import AuthenticatedActor

router = APIRouter()

__all__ = ["router"]

DEFAULT_STALE_AFTER_DAYS = 365
CORROBORATED_SOURCE_COUNT = 2
MAX_DUPLICATE_CLUSTERS = 5
MAX_DUPLICATE_CLUSTER_RECORDS = 5
MAX_STALE_RECORDS = 10

ConfidenceState = Literal["corroborated", "partial", "unverified"]


@dataclass(slots=True)
class QualityRecord:
    """One org-owned catalog record with derived source quality signals."""

    id: str
    name: str
    type: str
    city: str | None
    state: str | None
    source_count: int
    latest_source_date: str | None


class QualitySourceCoverage(BaseModel):
    """Source coverage summary for workspace-owned records."""

    total_records: int = Field(..., ge=0)
    source_backed_records: int = Field(..., ge=0)
    unsourced_records: int = Field(..., ge=0)
    coverage_percent: float = Field(..., ge=0, le=100)


class QualityDuplicateRecord(BaseModel):
    """One record inside a duplicate-risk cluster."""

    id: str
    name: str


class QualityDuplicateCluster(BaseModel):
    """A set of records with the same normalized name and place."""

    key: str
    record_count: int = Field(..., ge=0)
    records: list[QualityDuplicateRecord]


class QualityDuplicateRisk(BaseModel):
    """Duplicate-risk rollup for workspace-owned records."""

    cluster_count: int = Field(..., ge=0)
    record_count: int = Field(..., ge=0)
    clusters: list[QualityDuplicateCluster]


class QualityConfidenceBucket(BaseModel):
    """Source-confidence bucket for workspace-owned records."""

    state: ConfidenceState
    record_count: int = Field(..., ge=0)


class QualityStaleRecord(BaseModel):
    """Record whose latest source receipt is older than the quality threshold."""

    id: str
    name: str
    latest_source_date: str
    source_count: int = Field(..., ge=0)


class QualityStaleRecords(BaseModel):
    """Stale-source rollup for workspace-owned records."""

    threshold_days: int = Field(..., ge=1)
    record_count: int = Field(..., ge=0)
    records: list[QualityStaleRecord]


class QualityDataBoundary(BaseModel):
    """Boundary statement for the quality summary."""

    private_notes_included: bool
    statement: str


class OrgQualitySummaryResponse(BaseModel):
    """Workspace ingestion quality summary."""

    org_id: str
    generated_at: str
    source_coverage: QualitySourceCoverage
    duplicate_risk: QualityDuplicateRisk
    confidence_distribution: list[QualityConfidenceBucket]
    stale_records: QualityStaleRecords
    data_boundary: QualityDataBoundary


async def get_db(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Yield a per-request database connection."""
    conn = await get_db_connection(settings.database_url, backend=settings.database_backend)
    try:
        yield conn
    finally:
        await conn.close()


def _verify_org_access(actor: AuthenticatedActor, org_id: str) -> None:
    """Validate that the path org_id matches the actor's org_id."""
    if actor.org_id != org_id:
        raise HTTPException(status_code=403, detail="Access denied: org_id mismatch")


async def _load_quality_records(
    conn: aiosqlite.Connection,
    *,
    org_id: str,
) -> list[QualityRecord]:
    """Load org-owned active records with linked source counts."""
    cursor = await conn.execute(
        """
        SELECT
            e.id,
            e.name,
            e.type,
            e.city,
            e.state,
            COUNT(DISTINCT s.id) AS source_count,
            MAX(COALESCE(s.published_date, DATE(s.ingested_at))) AS latest_source_date
        FROM entries e
        JOIN resource_ownership ro
            ON ro.resource_id = e.id
            AND ro.resource_type = 'entry'
            AND ro.org_id = ?
        LEFT JOIN entry_sources es ON es.entry_id = e.id
        LEFT JOIN sources s ON s.id = es.source_id
        WHERE e.active = TRUE
        GROUP BY e.id, e.name, e.type, e.city, e.state
        ORDER BY e.name ASC, e.id ASC
        """,
        (org_id,),
    )
    rows = await cursor.fetchall()
    if not rows:
        return []
    columns = [col[0] for col in cursor.description]
    return [_quality_record_from_row(dict(zip(columns, row, strict=False))) for row in rows]


def _quality_record_from_row(row: dict[str, object]) -> QualityRecord:
    """Convert one quality query row into a typed record."""
    latest_source_date = row.get("latest_source_date")
    source_count_value = row.get("source_count") or 0
    return QualityRecord(
        id=str(row["id"]),
        name=str(row["name"]),
        type=str(row["type"]),
        city=str(row["city"]) if row.get("city") is not None else None,
        state=str(row["state"]) if row.get("state") is not None else None,
        source_count=int(str(source_count_value)),
        latest_source_date=str(latest_source_date)[:10] if latest_source_date else None,
    )


def _source_coverage(records: list[QualityRecord]) -> QualitySourceCoverage:
    """Build the source coverage summary."""
    total_records = len(records)
    source_backed_records = sum(1 for record in records if record.source_count > 0)
    coverage_percent = (
        round((source_backed_records / total_records) * 100, 1) if total_records else 0.0
    )
    return QualitySourceCoverage(
        total_records=total_records,
        source_backed_records=source_backed_records,
        unsourced_records=total_records - source_backed_records,
        coverage_percent=coverage_percent,
    )


def _confidence_state(record: QualityRecord) -> ConfidenceState:
    """Return a source-confidence state for one record."""
    if record.source_count >= CORROBORATED_SOURCE_COUNT:
        return "corroborated"
    if record.source_count == 1:
        return "partial"
    return "unverified"


def _confidence_distribution(records: list[QualityRecord]) -> list[QualityConfidenceBucket]:
    """Build source-confidence buckets in stable display order."""
    states: tuple[ConfidenceState, ...] = ("corroborated", "partial", "unverified")
    counts: dict[ConfidenceState, int] = {
        "corroborated": 0,
        "partial": 0,
        "unverified": 0,
    }
    for record in records:
        counts[_confidence_state(record)] += 1
    return [QualityConfidenceBucket(state=state, record_count=counts[state]) for state in states]


def _duplicate_key(record: QualityRecord) -> str:
    """Return the duplicate-risk key for one record."""
    city = record.city.casefold() if record.city else ""
    state = record.state.casefold() if record.state else ""
    return "|".join((record.name.strip().casefold(), record.type, city, state))


def _duplicate_label(record: QualityRecord) -> str:
    """Return a readable duplicate cluster label."""
    place = ", ".join(part for part in (record.city, record.state) if part)
    return f"{record.name} ({place})" if place else record.name


def _duplicate_risk(records: list[QualityRecord]) -> QualityDuplicateRisk:
    """Build duplicate-risk clusters for records sharing name, type, and place."""
    clusters: dict[str, list[QualityRecord]] = {}
    for record in records:
        clusters.setdefault(_duplicate_key(record), []).append(record)

    duplicate_clusters = [cluster for cluster in clusters.values() if len(cluster) > 1]
    duplicate_clusters.sort(key=lambda cluster: (-len(cluster), cluster[0].name.casefold()))

    return QualityDuplicateRisk(
        cluster_count=len(duplicate_clusters),
        record_count=sum(len(cluster) for cluster in duplicate_clusters),
        clusters=[
            QualityDuplicateCluster(
                key=_duplicate_label(cluster[0]),
                record_count=len(cluster),
                records=[
                    QualityDuplicateRecord(id=record.id, name=record.name)
                    for record in cluster[:MAX_DUPLICATE_CLUSTER_RECORDS]
                ],
            )
            for cluster in duplicate_clusters[:MAX_DUPLICATE_CLUSTERS]
        ],
    )


def _parse_date(value: str | None) -> datetime | None:
    """Parse a YYYY-MM-DD source date."""
    if value is None:
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").replace(tzinfo=UTC)
    except ValueError:
        return None


def _stale_records(
    records: list[QualityRecord],
    *,
    stale_after_days: int,
) -> QualityStaleRecords:
    """Build the stale-source rollup for source-backed records."""
    threshold = datetime.now(UTC) - timedelta(days=stale_after_days)
    stale = [
        record
        for record in records
        if record.source_count > 0
        and (latest := _parse_date(record.latest_source_date)) is not None
        and latest < threshold
    ]
    stale.sort(key=lambda record: (record.latest_source_date or "", record.name.casefold()))
    return QualityStaleRecords(
        threshold_days=stale_after_days,
        record_count=len(stale),
        records=[
            QualityStaleRecord(
                id=record.id,
                name=record.name,
                latest_source_date=record.latest_source_date or "",
                source_count=record.source_count,
            )
            for record in stale[:MAX_STALE_RECORDS]
        ],
    )


def _data_boundary() -> QualityDataBoundary:
    """Return the quality-summary data boundary."""
    return QualityDataBoundary(
        private_notes_included=False,
        statement=(
            "Quality signals are derived from workspace-owned records and linked source "
            "receipts; private notes are excluded."
        ),
    )


@router.get(
    "",
    response_model=OrgQualitySummaryResponse,
    summary="Get workspace ingestion quality summary",
    operation_id="getOrgQualitySummary",
    tags=["org-quality"],
)
async def get_org_quality_summary(
    org_id: str,
    response: Response,
    stale_after_days: int = Query(DEFAULT_STALE_AFTER_DAYS, ge=1, le=3650),
    actor: AuthenticatedActor = Depends(require_org_actor),
    db: aiosqlite.Connection = Depends(get_db),
) -> OrgQualitySummaryResponse:
    """Return source coverage, duplicate risk, confidence, and stale-record signals."""
    _verify_org_access(actor, org_id)
    records = await _load_quality_records(db, org_id=org_id)
    apply_no_store_headers(response)
    return OrgQualitySummaryResponse(
        org_id=org_id,
        generated_at=datetime.now(UTC).isoformat(),
        source_coverage=_source_coverage(records),
        duplicate_risk=_duplicate_risk(records),
        confidence_distribution=_confidence_distribution(records),
        stale_records=_stale_records(records, stale_after_days=stale_after_days),
        data_boundary=_data_boundary(),
    )
