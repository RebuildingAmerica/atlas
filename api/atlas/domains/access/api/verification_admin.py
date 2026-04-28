"""Admin endpoints for managing discount verification records."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

router = APIRouter(tags=["access"])

__all__ = ["router"]


class VerificationRecordResponse(BaseModel):
    """Response payload for a verification record."""

    user_id: str = Field(description="User ID who submitted the verification")
    segment: Literal["independent_journalist", "grassroots_nonprofit", "civic_tech_worker"]
    status: str = Field(description="Verification status")
    method: str = Field(description="Verification method used")
    submitted_at: str = Field(description="ISO timestamp of submission")
    verified_at: str | None = Field(description="ISO timestamp of verification", default=None)
    verification_data: dict[str, str] | None = Field(default=None)
    notes: str | None = Field(default=None)


class VerificationListResponse(BaseModel):
    """Response payload for list of verification records."""

    records: list[VerificationRecordResponse]
    total: int = Field(description="Total number of records matching filters")
    status_filter: str | None = Field(default=None)
    segment_filter: str | None = Field(default=None)


class VerificationUpdateRequest(BaseModel):
    """Request to update verification status."""

    status: Literal["verified", "rejected"]
    notes: str | None = Field(default=None)


class VerificationUpdateResponse(BaseModel):
    """Response after updating verification."""

    status: str
    message: str


@router.get(
    "/api/admin/verifications",
    response_model=VerificationListResponse,
    operation_id="listVerifications",
    summary="List discount verifications",
    description="List discount verification requests for manual review.",
)
async def list_verifications(
    response: Response,  # noqa: ARG001 - reserved for cache/header handling
    status: str | None = Query(default=None),
    segment: str | None = Query(default=None),
) -> VerificationListResponse:
    """List discount verification requests for manual review."""
    # TODO: Check admin authorization
    # TODO: Fetch verification records from database
    # TODO: Filter by status and segment if provided
    # TODO: Return paginated results

    # Placeholder: Return empty list
    return VerificationListResponse(
        records=[],
        total=0,
        status_filter=status,
        segment_filter=segment,
    )


@router.patch(
    "/api/admin/verifications/{user_id}",
    response_model=VerificationUpdateResponse,
    operation_id="updateVerification",
    summary="Update discount verification",
    description="Update the review status for a discount verification request.",
)
async def update_verification(
    response: Response,  # noqa: ARG001 - reserved for cache/header handling
    user_id: str,  # noqa: ARG001 - must match {user_id} in route path
    request: VerificationUpdateRequest,
) -> VerificationUpdateResponse:
    """Update the review status for a discount verification request."""
    _ = request
    # TODO: Check admin authorization
    # TODO: Fetch verification record from database
    # TODO: Update status and notes
    # TODO: Persist changes and return updated record

    raise HTTPException(status_code=501, detail="Verification updates not yet implemented")
