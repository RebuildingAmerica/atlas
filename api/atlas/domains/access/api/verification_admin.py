"""Admin endpoints for managing discount verification records."""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from atlas.domains.access.dependencies import get_usage_db, require_actor
from atlas.domains.access.models.discount_verifications import (
    DiscountVerificationCRUD,
    DiscountVerificationMethod,
    DiscountVerificationModel,
    DiscountVerificationStatus,
)
from atlas.domains.access.verification import DiscountSegment  # noqa: TC001
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access.principals import AuthenticatedActor

router = APIRouter(tags=["access"])

__all__ = ["router"]


class VerificationRecordResponse(BaseModel):
    """Response payload for a verification record."""

    id: str = Field(description="Verification record ID")
    user_id: str = Field(description="User ID who submitted the verification")
    organization_id: str = Field(description="Workspace receiving the verified discount")
    segment: DiscountSegment
    status: DiscountVerificationStatus = Field(description="Verification status")
    method: DiscountVerificationMethod = Field(description="Verification method used")
    submitted_at: str = Field(description="ISO timestamp of submission")
    verified_at: str | None = Field(description="ISO timestamp of verification", default=None)
    verification_data: dict[str, str] = Field(default_factory=dict)
    notes: str | None = Field(default=None)


class VerificationListResponse(BaseModel):
    """Response payload for list of verification records."""

    records: list[VerificationRecordResponse]
    total: int = Field(description="Total number of records matching filters")
    organization_id_filter: str | None = Field(default=None)
    status_filter: DiscountVerificationStatus | None = Field(default=None)
    segment_filter: DiscountSegment | None = Field(default=None)


class VerificationUpdateRequest(BaseModel):
    """Request to update verification status."""

    status: Literal["verified", "rejected"]
    notes: str | None = Field(default=None)


class VerificationUpdateResponse(BaseModel):
    """Response after updating verification."""

    status: Literal["verified", "rejected"]
    message: str
    record: VerificationRecordResponse


def _verification_record_response(
    record: DiscountVerificationModel,
) -> VerificationRecordResponse:
    """Build an API response payload from a stored verification record."""
    return VerificationRecordResponse(
        id=record.id,
        user_id=record.user_id,
        organization_id=record.organization_id,
        segment=record.segment,
        status=record.status,
        method=record.method,
        submitted_at=record.submitted_at,
        verified_at=record.verified_at,
        verification_data=record.verification_data,
        notes=record.notes,
    )


def _normalized_allowed_operator_emails(settings: Settings) -> set[str]:
    """Return the normalized operator-review allowlist."""
    return {email.strip().lower() for email in settings.operator_allowed_emails if email.strip()}


async def require_discount_review_actor(
    actor: AuthenticatedActor = Depends(require_actor),
    settings: Settings = Depends(get_settings),
) -> AuthenticatedActor:
    """Require an Atlas operator for discount verification review endpoints."""
    if not settings.managed:
        # Discount review is a Rebuilding America commercial function. Someone
        # self-hosting Atlas has no Atlas discounts to review, so the surface
        # does not exist for them rather than standing open.
        raise HTTPException(status_code=404, detail="Not found.")

    if actor.is_local:
        return actor

    if actor.auth_type != "internal":
        raise HTTPException(status_code=403, detail="Discount review access requires Atlas staff.")

    if actor.email.strip().lower() not in _normalized_allowed_operator_emails(settings):
        raise HTTPException(status_code=403, detail="Discount review access requires Atlas staff.")

    return actor


@router.get(
    "/api/admin/verifications",
    response_model=VerificationListResponse,
    operation_id="listVerifications",
    summary="List discount verifications",
    description="List discount verification requests for manual review.",
)
async def list_verifications(
    response: Response,
    conn: aiosqlite.Connection = Depends(get_usage_db),
    _review_actor: AuthenticatedActor = Depends(require_discount_review_actor),
    *,
    organization_id: Annotated[str | None, Query()] = None,
    status: Annotated[DiscountVerificationStatus | None, Query()] = None,
    segment: Annotated[DiscountSegment | None, Query()] = None,
) -> VerificationListResponse:
    """List discount verification requests for manual review."""
    apply_no_store_headers(response)
    records = await DiscountVerificationCRUD.list(
        conn,
        organization_id=organization_id,
        status=status,
        segment=segment,
    )
    total = await DiscountVerificationCRUD.count(
        conn,
        organization_id=organization_id,
        status=status,
        segment=segment,
    )
    return VerificationListResponse(
        organization_id_filter=organization_id,
        records=[_verification_record_response(record) for record in records],
        total=total,
        status_filter=status,
        segment_filter=segment,
    )


@router.patch(
    "/api/admin/verifications/{verification_id}",
    response_model=VerificationUpdateResponse,
    operation_id="updateVerification",
    summary="Update discount verification",
    description="Update the review status for a discount verification request.",
)
async def update_verification(
    response: Response,
    verification_id: str,
    request: VerificationUpdateRequest,
    conn: aiosqlite.Connection = Depends(get_usage_db),
    _review_actor: AuthenticatedActor = Depends(require_discount_review_actor),
) -> VerificationUpdateResponse:
    """Update the review status for a discount verification request."""
    apply_no_store_headers(response)
    record = await DiscountVerificationCRUD.update_status(
        conn,
        verification_id,
        status=request.status,
        notes=request.notes,
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Verification record not found")

    return VerificationUpdateResponse(
        status=request.status,
        message="Verification review updated.",
        record=_verification_record_response(record),
    )
