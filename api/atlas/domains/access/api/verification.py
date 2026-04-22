"""Discount verification API endpoints."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from atlas.domains.access.verification import (
    DiscountVerifier,
    VerificationMethod,
    VerificationStatus,
)
from atlas.platform.http.cache import apply_no_store_headers

router = APIRouter()

__all__ = ["router"]


class VerificationRequestPayload(BaseModel):
    """Request payload for discount verification submission."""

    segment: Literal["independent_journalist", "grassroots_nonprofit", "civic_tech_worker"]
    user_id: str
    data: dict[str, str] = Field(description="Segment-specific verification data")


class VerificationResponsePayload(BaseModel):
    """Response payload for verification submission."""

    status: str = Field(description="Verification status (pending, verified, rejected, expired)")
    message: str = Field(description="Human-readable status message")
    verification_method: str | None = Field(
        description="Method used for verification", default=None
    )


def _validate_independent_journalist(
    data: dict[str, str], verifier: DiscountVerifier
) -> tuple[str | None, VerificationMethod]:
    """Validate independent journalist data. Returns error message or None."""
    portfolio_url = data.get("portfolioUrl")
    if not portfolio_url:
        return "Portfolio URL is required", VerificationMethod.PORTFOLIO

    is_valid, error_message = verifier.verify_independent_journalist(portfolio_url)
    if not is_valid:
        return error_message or "Validation failed", VerificationMethod.PORTFOLIO

    return None, VerificationMethod.PORTFOLIO


def _validate_grassroots_nonprofit(
    data: dict[str, str], verifier: DiscountVerifier
) -> tuple[str | None, VerificationMethod]:
    """Validate grassroots nonprofit data. Returns error message or None."""
    ein_or_name = data.get("einOrName")
    budget = data.get("budget")

    if not ein_or_name:
        return "Organization name or EIN is required", VerificationMethod.EIN_SUBMISSION

    if not budget:
        return "Annual budget is required", VerificationMethod.EIN_SUBMISSION

    is_valid, error_message = verifier.verify_grassroots_nonprofit(ein_or_name, budget)
    if not is_valid:
        return error_message or "Validation failed", VerificationMethod.EIN_SUBMISSION

    return None, VerificationMethod.EIN_SUBMISSION


def _validate_civic_tech_worker(
    data: dict[str, str], verifier: DiscountVerifier
) -> tuple[str | None, VerificationMethod]:
    """Validate civic tech worker data. Returns error message or None."""
    project_url = data.get("projectUrl")
    mission = data.get("mission")

    if not project_url:
        return "Project URL is required", VerificationMethod.MISSION_STATEMENT

    if not mission:
        return "Mission statement is required", VerificationMethod.MISSION_STATEMENT

    is_valid, error_message = verifier.verify_civic_tech_worker(project_url, mission)
    if not is_valid:
        return error_message or "Validation failed", VerificationMethod.MISSION_STATEMENT

    return None, VerificationMethod.MISSION_STATEMENT


@router.post("/api/access/verify-discount", response_model=VerificationResponsePayload)
async def submit_discount_verification(
    request: VerificationRequestPayload,
    response: Response,
) -> VerificationResponsePayload:
    """
    Submit a discount verification request.

    Validates the submission and creates a verification record (initially PENDING).
    All verifications require manual review.

    Args:
        request: Verification request with segment, user_id, and segment-specific data
        response: FastAPI response object for setting headers

    Returns:
        VerificationResponsePayload with status and message

    Raises:
        HTTPException: If validation fails (400) or processing fails (500)
    """
    apply_no_store_headers(response)

    verifier = DiscountVerifier()

    # Validate based on segment
    if request.segment == "independent_journalist":
        error, method = _validate_independent_journalist(request.data, verifier)
    elif request.segment == "grassroots_nonprofit":
        error, method = _validate_grassroots_nonprofit(request.data, verifier)
    elif request.segment == "civic_tech_worker":
        error, method = _validate_civic_tech_worker(request.data, verifier)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown segment: {request.segment}")

    if error:
        raise HTTPException(status_code=400, detail=error)

    # Create verification record (with PENDING status for manual review)
    try:
        record = verifier.create_verification_record(
            user_id=request.user_id,
            segment=request.segment,
            method=method,
            status=VerificationStatus.PENDING,
            verification_data=request.data,
            notes="Awaiting manual verification review",
        )

        # TODO: Persist verification record to database

        return VerificationResponsePayload(
            status=record.status,
            message="Verification request submitted. We'll review it and email you shortly.",
            verification_method=record.method,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail="An error occurred while processing your verification request.",
        ) from e
