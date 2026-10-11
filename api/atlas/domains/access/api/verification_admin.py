"""Platform endpoints for reviewing discount requests, called by the platform admin."""

from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING, Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from atlas.domains.access.dependencies import get_usage_db
from atlas.domains.access.discount_review_notice import notify_discount_review_result
from atlas.domains.access.models.discount_verifications import (
    DiscountVerificationCRUD,
    DiscountVerificationMethod,
    DiscountVerificationModel,
    DiscountVerificationStatus,
)
from atlas.domains.access.verification import DiscountSegment  # noqa: TC001
from atlas.platform.authz import Action, PlatformOperator, require_platform_action
from atlas.platform.config import Settings, get_settings
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

UNSENT_RESULT_DETAIL = "The decision was saved, but the applicant could not be emailed."

router = APIRouter(tags=["platform"])

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


@router.get(
    "/api/platform/discount-verifications",
    response_model=VerificationListResponse,
    operation_id="listVerifications",
    summary="List discount verifications",
    description="List discount verification requests for manual review.",
)
async def list_verifications(
    response: Response,
    conn: aiosqlite.Connection = Depends(get_usage_db),
    _operator: PlatformOperator = Depends(require_platform_action(Action.DISCOUNTS_REVIEW)),
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
    "/api/platform/discount-verifications/{verification_id}",
    response_model=VerificationUpdateResponse,
    operation_id="updateVerification",
    summary="Update discount verification",
    description=(
        "Record the review decision for a discount request, then email the applicant "
        "through the app. A 502 means the decision was saved but the email was not sent."
    ),
)
async def update_verification(
    response: Response,
    verification_id: str,
    request: VerificationUpdateRequest,
    conn: aiosqlite.Connection = Depends(get_usage_db),
    settings: Settings = Depends(get_settings),
    _operator: PlatformOperator = Depends(require_platform_action(Action.DISCOUNTS_REVIEW)),
) -> VerificationUpdateResponse:
    """Record the review decision, then have the app email the applicant."""
    apply_no_store_headers(response)
    record = await DiscountVerificationCRUD.update_status(
        conn,
        verification_id,
        status=request.status,
        notes=request.notes,
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Verification record not found")

    try:
        await notify_discount_review_result(
            settings,
            user_id=record.user_id,
            segment=record.segment,
            status=request.status,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=HTTPStatus.BAD_GATEWAY, detail=UNSENT_RESULT_DETAIL
        ) from exc

    return VerificationUpdateResponse(
        status=request.status,
        message="Verification review updated.",
        record=_verification_record_response(record),
    )
