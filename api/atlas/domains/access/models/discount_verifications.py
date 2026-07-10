"""Persistent discount verification records for billing review."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, cast

from atlas.platform.database import db

if TYPE_CHECKING:
    from collections.abc import Sequence

    import aiosqlite

    from atlas.domains.access.verification import DiscountSegment, VerificationMethod

DiscountVerificationStatus = Literal["pending", "verified", "rejected", "expired"]
DiscountVerificationMethod = Literal[
    "portfolio",
    "school_email",
    "ein_submission",
    "mission_statement",
]

__all__ = [
    "DiscountVerificationCRUD",
    "DiscountVerificationCreate",
    "DiscountVerificationMethod",
    "DiscountVerificationModel",
    "DiscountVerificationStatus",
]


@dataclass(slots=True)
class DiscountVerificationModel:
    """A durable discount verification request awaiting or reflecting review."""

    id: str
    user_id: str
    organization_id: str
    segment: DiscountSegment
    status: DiscountVerificationStatus
    method: DiscountVerificationMethod
    submitted_at: str
    verified_at: str | None
    verification_data: dict[str, str]
    notes: str | None


@dataclass(slots=True)
class DiscountVerificationCreate:
    """Input for creating one pending discount verification request."""

    user_id: str
    organization_id: str
    segment: DiscountSegment
    method: DiscountVerificationMethod | VerificationMethod
    verification_data: dict[str, str]
    notes: str | None = None


def _coerce_verification_method(
    method: DiscountVerificationMethod | VerificationMethod,
) -> DiscountVerificationMethod:
    """Return a string literal verification method from API enum or model input."""
    return cast("DiscountVerificationMethod", str(method))


def _decode_verification_data(raw_data: str) -> dict[str, str]:
    """Decode stored verification JSON into a string-only dictionary."""
    decoded = db.decode_json(raw_data)
    if not isinstance(decoded, dict):
        return {}
    return {
        str(key): str(value)
        for key, value in decoded.items()
        if isinstance(key, str) and isinstance(value, str)
    }


def _row_to_discount_verification(row: Sequence[object]) -> DiscountVerificationModel:
    """Convert a database row into a typed discount verification record."""
    return DiscountVerificationModel(
        id=str(row[0]),
        user_id=str(row[1]),
        organization_id=str(row[2]),
        segment=cast("DiscountSegment", row[3]),
        status=cast("DiscountVerificationStatus", row[4]),
        method=cast("DiscountVerificationMethod", row[5]),
        submitted_at=str(row[6]),
        verified_at=str(row[7]) if row[7] is not None else None,
        verification_data=_decode_verification_data(str(row[8])),
        notes=str(row[9]) if row[9] is not None else None,
    )


def _build_verification_filters(
    *,
    organization_id: str | None,
    segment: DiscountSegment | None,
    status: DiscountVerificationStatus | None,
) -> tuple[str, tuple[str, ...]]:
    """Build the shared WHERE clause for verification list/count queries."""
    clauses: list[str] = []
    params: list[str] = []
    if status is not None:
        clauses.append("status = ?")
        params.append(status)
    if segment is not None:
        clauses.append("segment = ?")
        params.append(segment)
    if organization_id is not None:
        clauses.append("organization_id = ?")
        params.append(organization_id)
    return (f"WHERE {' AND '.join(clauses)}" if clauses else "", tuple(params))


class DiscountVerificationCRUD:
    """CRUD operations for durable discount verification review records."""

    @staticmethod
    async def create(
        conn: aiosqlite.Connection,
        record_input: DiscountVerificationCreate,
    ) -> DiscountVerificationModel:
        """Create one pending discount verification record."""
        record_id = db.generate_uuid()
        submitted_at = db.now_iso()
        method = _coerce_verification_method(record_input.method)
        await conn.execute(
            """
            INSERT INTO discount_verifications (
                id, user_id, organization_id, segment, status, method,
                submitted_at, verified_at, verification_data_json, notes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record_id,
                record_input.user_id,
                record_input.organization_id,
                record_input.segment,
                "pending",
                method,
                submitted_at,
                None,
                db.encode_json(record_input.verification_data),
                record_input.notes,
            ),
        )
        await conn.commit()
        record = await DiscountVerificationCRUD.get_by_id(conn, record_id)
        assert record is not None, "discount verification was just inserted"
        return record

    @staticmethod
    async def get_by_id(
        conn: aiosqlite.Connection,
        verification_id: str,
    ) -> DiscountVerificationModel | None:
        """Return one discount verification record by id."""
        cursor = await conn.execute(
            """
            SELECT id, user_id, organization_id, segment, status, method,
                   submitted_at, verified_at, verification_data_json, notes
            FROM discount_verifications
            WHERE id = ?
            """,
            (verification_id,),
        )
        row = await cursor.fetchone()
        return _row_to_discount_verification(row) if row is not None else None

    @staticmethod
    async def list(
        conn: aiosqlite.Connection,
        *,
        organization_id: str | None = None,
        status: DiscountVerificationStatus | None = None,
        segment: DiscountSegment | None = None,
    ) -> list[DiscountVerificationModel]:
        """Return discount verification records matching optional review filters."""
        where_sql, params = _build_verification_filters(
            organization_id=organization_id,
            segment=segment,
            status=status,
        )
        cursor = await conn.execute(
            f"""
            SELECT id, user_id, organization_id, segment, status, method,
                   submitted_at, verified_at, verification_data_json, notes
            FROM discount_verifications
            {where_sql}
            ORDER BY submitted_at DESC, id DESC
            """,
            params,
        )
        rows = await cursor.fetchall()
        return [_row_to_discount_verification(row) for row in rows]

    @staticmethod
    async def count(
        conn: aiosqlite.Connection,
        *,
        organization_id: str | None = None,
        status: DiscountVerificationStatus | None = None,
        segment: DiscountSegment | None = None,
    ) -> int:
        """Return the count of discount verification records matching filters."""
        where_sql, params = _build_verification_filters(
            organization_id=organization_id,
            segment=segment,
            status=status,
        )
        cursor = await conn.execute(
            f"SELECT COUNT(*) FROM discount_verifications {where_sql}",
            params,
        )
        row = await cursor.fetchone()
        return int(row[0]) if row is not None else 0

    @staticmethod
    async def update_status(
        conn: aiosqlite.Connection,
        verification_id: str,
        *,
        status: Literal["verified", "rejected"],
        notes: str | None,
    ) -> DiscountVerificationModel | None:
        """Update a verification review status and return the stored record."""
        verified_at = db.now_iso() if status == "verified" else None
        await conn.execute(
            """
            UPDATE discount_verifications
            SET status = ?, verified_at = ?, notes = ?
            WHERE id = ?
            """,
            (status, verified_at, notes, verification_id),
        )
        await conn.commit()
        return await DiscountVerificationCRUD.get_by_id(conn, verification_id)
