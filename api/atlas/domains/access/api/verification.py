"""Discount verification API endpoints."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from atlas.domains.access.dependencies import get_usage_db, require_actor
from atlas.domains.access.models.discount_verifications import (
    DiscountVerificationCreate,
    DiscountVerificationCRUD,
    DiscountVerificationMethod,
    DiscountVerificationModel,
    DiscountVerificationStatus,
)
from atlas.domains.access.verification import (
    DiscountSegment,
    DiscountVerifier,
    VerificationMethod,
)
from atlas.platform.http.cache import apply_no_store_headers

if TYPE_CHECKING:
    import aiosqlite

    from atlas.domains.access.principals import AuthenticatedActor

router = APIRouter(tags=["access"])

__all__ = ["router"]


class VerificationRequestPayload(BaseModel):
    """Request payload for discount verification submission."""

    segment: DiscountSegment
    organization_id: str
    data: dict[str, str] = Field(description="Segment-specific verification data")


class VerificationResponsePayload(BaseModel):
    """Response payload for verification submission."""

    id: str = Field(description="Verification record ID")
    organization_id: str = Field(description="Workspace receiving the verified discount")
    status: DiscountVerificationStatus = Field(
        description="Verification status (pending, verified, rejected, expired)"
    )
    message: str = Field(description="Human-readable status message")
    verification_method: DiscountVerificationMethod | None = Field(
        description="Method used for verification", default=None
    )


class CurrentVerificationRecordResponse(BaseModel):
    """Requester-safe discount verification status for one workspace."""

    id: str = Field(description="Verification record ID")
    organization_id: str = Field(description="Workspace receiving the discount")
    segment: DiscountSegment
    status: DiscountVerificationStatus = Field(description="Verification status")
    submitted_at: str = Field(description="ISO timestamp of submission")
    verified_at: str | None = Field(description="ISO timestamp of verification", default=None)


class CurrentVerificationStatusResponse(BaseModel):
    """Current requester's latest discount verification status."""

    record: CurrentVerificationRecordResponse | None = Field(default=None)


def _current_verification_record_response(
    record: DiscountVerificationModel,
) -> CurrentVerificationRecordResponse:
    """Build the requester-safe status response for a verification record."""
    return CurrentVerificationRecordResponse(
        id=record.id,
        organization_id=record.organization_id,
        segment=record.segment,
        status=record.status,
        submitted_at=record.submitted_at,
        verified_at=record.verified_at,
    )


def _require_actor_workspace(actor: AuthenticatedActor) -> str:
    """Return the authenticated actor workspace or reject the request."""
    if actor.org_id is None:
        raise HTTPException(status_code=400, detail="Active workspace is required.")
    return actor.org_id


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


def _validate_student(
    data: dict[str, str], verifier: DiscountVerifier
) -> tuple[str | None, VerificationMethod]:
    """Validate student data. Returns error message or None."""
    school_email = data.get("schoolEmail")
    school_name = data.get("schoolName")

    if not school_email:
        return "School email is required", VerificationMethod.SCHOOL_EMAIL

    if not school_name:
        return "School or program is required", VerificationMethod.SCHOOL_EMAIL

    is_valid, error_message = verifier.verify_student(school_email, school_name)
    if not is_valid:
        return error_message or "Validation failed", VerificationMethod.SCHOOL_EMAIL

    return None, VerificationMethod.SCHOOL_EMAIL


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


@router.post(
    "/api/access/verify-discount",
    response_model=VerificationResponsePayload,
    operation_id="submitDiscountVerification",
    summary="Submit discount verification",
    description="Validate a discount verification request and record it for manual review.",
)
async def submit_discount_verification(
    request: VerificationRequestPayload,
    response: Response,
    conn: aiosqlite.Connection = Depends(get_usage_db),
    actor: AuthenticatedActor = Depends(require_actor),
) -> VerificationResponsePayload:
    """Validate a discount verification request and record it for manual review."""
    apply_no_store_headers(response)
    actor_workspace_id = _require_actor_workspace(actor)
    if actor_workspace_id != request.organization_id:
        raise HTTPException(status_code=403, detail="Workspace mismatch.")

    verifier = DiscountVerifier()

    # Validate based on segment
    if request.segment == "student":
        error, method = _validate_student(request.data, verifier)
    elif request.segment == "independent_journalist":
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
        record = await DiscountVerificationCRUD.create(
            conn,
            DiscountVerificationCreate(
                user_id=actor.user_id,
                organization_id=request.organization_id,
                segment=request.segment,
                method=method,
                verification_data=request.data,
                notes="Awaiting manual verification review",
            ),
        )

        return VerificationResponsePayload(
            id=record.id,
            organization_id=record.organization_id,
            status=record.status,
            message="Verification request submitted. We'll review it and email you shortly.",
            verification_method=record.method,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail="An error occurred while processing your verification request.",
        ) from e


@router.get(
    "/api/access/discount-verification/current",
    response_model=CurrentVerificationStatusResponse,
    operation_id="getCurrentDiscountVerificationStatus",
    summary="Get current discount verification status",
    description="Return the signed-in requester's latest discount verification status.",
)
async def get_current_discount_verification_status(
    response: Response,
    conn: aiosqlite.Connection = Depends(get_usage_db),
    actor: AuthenticatedActor = Depends(require_actor),
) -> CurrentVerificationStatusResponse:
    """Return the latest discount verification status for the current workspace actor."""
    apply_no_store_headers(response)
    organization_id = _require_actor_workspace(actor)
    record = await DiscountVerificationCRUD.latest_for_submitter(
        conn,
        organization_id=organization_id,
        user_id=actor.user_id,
    )
    return CurrentVerificationStatusResponse(
        record=_current_verification_record_response(record) if record is not None else None
    )
