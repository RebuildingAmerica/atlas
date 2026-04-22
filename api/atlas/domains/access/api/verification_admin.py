"""Admin endpoints for managing discount verification records."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

router = APIRouter()

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


@router.get("/api/admin/verifications", response_model=VerificationListResponse)
async def list_verifications(
    _response_obj: Response,
    _status: str | None = None,
    _segment: str | None = None,
) -> VerificationListResponse:
    """
    List discount verification records (admin only).

    Args:
        _status: Filter by status (pending, verified, rejected, expired)
        _segment: Filter by segment (independent_journalist, grassroots_nonprofit, civic_tech_worker)
        _response_obj: FastAPI response object for setting headers

    Returns:
        VerificationListResponse with records and metadata

    Raises:
        HTTPException: If admin access is denied (401) or processing fails (500)
    """
    # TODO: Check admin authorization
    # TODO: Fetch verification records from database
    # TODO: Filter by status and segment if provided
    # TODO: Return paginated results

    # Placeholder: Return empty list
    return VerificationListResponse(records=[], total=0)


@router.patch("/api/admin/verifications/{user_id}", response_model=VerificationUpdateResponse)
async def update_verification(
    _response_obj: Response,
    _user_id: str,
    _request: VerificationUpdateRequest,
) -> VerificationUpdateResponse:
    """
    Update a verification record status (admin only).

    Args:
        _user_id: The user ID of the verification to update
        _request: New status and optional notes
        _response_obj: FastAPI response object for setting headers

    Returns:
        VerificationUpdateResponse with updated status

    Raises:
        HTTPException: If not found (404), unauthorized (401), or processing fails (500)
    """
    # TODO: Check admin authorization
    # TODO: Fetch verification record from database
    # TODO: Update status and notes
    # TODO: Persist changes and return updated record

    raise HTTPException(status_code=501, detail="Verification updates not yet implemented")
