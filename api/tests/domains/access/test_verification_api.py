"""Tests for discount verification API helpers and endpoint."""

from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING

import pytest
from fastapi import HTTPException, Response

from atlas.domains.access.api.verification import (
    VerificationRequestPayload,
    _validate_civic_tech_worker,
    _validate_grassroots_nonprofit,
    _validate_independent_journalist,
    _validate_student,
    get_current_discount_verification_status,
    submit_discount_verification,
)
from atlas.domains.access.models.discount_verifications import (
    DiscountVerificationCreate,
    DiscountVerificationCRUD,
)
from atlas.domains.access.principals import AuthenticatedActor
from atlas.domains.access.verification import DiscountVerifier, VerificationMethod

if TYPE_CHECKING:
    import aiosqlite


def actor_for(user_id: str, organization_id: str) -> AuthenticatedActor:
    """Return an internal actor scoped to one test workspace."""
    return AuthenticatedActor(
        user_id=user_id,
        email=f"{user_id}@example.org",
        auth_type="internal",
        org_id=organization_id,
    )


def test_validate_independent_journalist_requires_portfolio_url() -> None:
    """Independent journalist validation requires a portfolio URL."""
    error, method = _validate_independent_journalist({}, DiscountVerifier())

    assert error == "Portfolio URL is required"
    assert method is VerificationMethod.PORTFOLIO


def test_validate_student_requires_school_email() -> None:
    """Student validation requires a school email."""
    error, method = _validate_student({"schoolName": "Howard University"}, DiscountVerifier())

    assert error == "School email is required"
    assert method is VerificationMethod.SCHOOL_EMAIL


def test_validate_grassroots_nonprofit_requires_budget() -> None:
    """Grassroots nonprofit validation requires a budget."""
    error, method = _validate_grassroots_nonprofit({"einOrName": "04-1798922"}, DiscountVerifier())

    assert error == "Annual budget is required"
    assert method is VerificationMethod.EIN_SUBMISSION


def test_validate_civic_tech_worker_requires_mission() -> None:
    """Civic tech validation requires a mission statement."""
    error, method = _validate_civic_tech_worker(
        {"projectUrl": "https://github.com/example/civic-tool"},
        DiscountVerifier(),
    )

    assert error == "Mission statement is required"
    assert method is VerificationMethod.MISSION_STATEMENT


@pytest.mark.asyncio
async def test_submit_discount_verification_returns_pending_response(
    test_db: aiosqlite.Connection,
) -> None:
    """Successful submissions return a pending verification payload."""
    response = await submit_discount_verification(
        VerificationRequestPayload(
            segment="independent_journalist",
            organization_id="org-123",
            data={"portfolioUrl": "https://example.com/portfolio"},
        ),
        Response(),
        test_db,
        actor_for("user-123", "org-123"),
    )

    assert response.status == "pending"
    assert response.verification_method == "portfolio"
    assert "Verification request submitted" in response.message


@pytest.mark.asyncio
async def test_submit_discount_verification_persists_record(
    test_db: aiosqlite.Connection,
) -> None:
    """Successful submissions create a durable record for admin review."""
    actor = AuthenticatedActor(
        user_id="user-606",
        email="student@example.edu",
        auth_type="internal",
        org_id="org-606",
    )
    response = await submit_discount_verification(
        VerificationRequestPayload(
            segment="student",
            organization_id="org-606",
            data={"schoolEmail": "student@example.edu", "schoolName": "Example College"},
        ),
        Response(),
        test_db,
        actor,
    )

    cursor = await test_db.execute(
        """
        SELECT id, user_id, organization_id, segment, status, method,
               verification_data_json, notes
        FROM discount_verifications
        WHERE id = ?
        """,
        (response.id,),
    )
    row = await cursor.fetchone()

    assert row is not None
    assert row[1] == "user-606"
    assert row[2] == "org-606"
    assert row[3] == "student"
    assert row[4] == "pending"
    assert row[5] == "school_email"
    assert "student@example.edu" in row[6]
    assert row[7] == "Awaiting manual verification review"


@pytest.mark.asyncio
async def test_current_discount_verification_status_returns_latest_actor_workspace_record(
    test_db: aiosqlite.Connection,
) -> None:
    """The requester sees the latest durable status for their active workspace."""
    actor = AuthenticatedActor(
        user_id="user-current",
        email="current@example.org",
        auth_type="internal",
        org_id="org-current",
    )
    await DiscountVerificationCRUD.create(
        test_db,
        DiscountVerificationCreate(
            user_id="user-other",
            organization_id="org-current",
            segment="student",
            method="school_email",
            verification_data={"schoolEmail": "other@example.edu"},
            notes="Other user",
        ),
    )
    old_record = await DiscountVerificationCRUD.create(
        test_db,
        DiscountVerificationCreate(
            user_id="user-current",
            organization_id="org-current",
            segment="student",
            method="school_email",
            verification_data={"schoolEmail": "current@example.edu"},
            notes="Older request",
        ),
    )
    await DiscountVerificationCRUD.update_status(
        test_db,
        old_record.id,
        status="verified",
        notes="Approved",
    )
    latest_record = await DiscountVerificationCRUD.create(
        test_db,
        DiscountVerificationCreate(
            user_id="user-current",
            organization_id="org-current",
            segment="independent_journalist",
            method="portfolio",
            verification_data={"portfolioUrl": "https://example.org/byline"},
            notes="Latest request",
        ),
    )

    response = await get_current_discount_verification_status(Response(), test_db, actor)

    assert response.record is not None
    assert response.record.id == latest_record.id
    assert response.record.status == "pending"
    assert response.record.segment == "independent_journalist"


@pytest.mark.asyncio
async def test_current_discount_verification_status_requires_workspace_context(
    test_db: aiosqlite.Connection,
) -> None:
    """The requester status endpoint only works for a signed-in workspace actor."""
    actor = AuthenticatedActor(
        user_id="user-current",
        email="current@example.org",
        auth_type="internal",
    )

    with pytest.raises(HTTPException) as exc_info:
        await get_current_discount_verification_status(Response(), test_db, actor)

    assert exc_info.value.status_code == HTTPStatus.BAD_REQUEST
    assert exc_info.value.detail == "Active workspace is required."


@pytest.mark.asyncio
async def test_submit_discount_verification_rejects_invalid_payload(
    test_db: aiosqlite.Connection,
) -> None:
    """Invalid submissions surface a 400 with the validation error."""
    with pytest.raises(HTTPException) as exc_info:
        await submit_discount_verification(
            VerificationRequestPayload(
                segment="civic_tech_worker",
                organization_id="org-456",
                data={"projectUrl": "https://github.com/example/civic-tool"},
            ),
            Response(),
            test_db,
            actor_for("user-456", "org-456"),
        )

    assert exc_info.value.status_code == HTTPStatus.BAD_REQUEST
    assert exc_info.value.detail == "Mission statement is required"


def test_validate_independent_journalist_rejects_non_http_url() -> None:
    """A portfolio URL that fails verifier validation surfaces the verifier's error."""
    error, method = _validate_independent_journalist(
        {"portfolioUrl": "not-a-url"}, DiscountVerifier()
    )

    assert error == "Portfolio URL must be a valid HTTP(S) URL"
    assert method is VerificationMethod.PORTFOLIO


def test_validate_grassroots_nonprofit_requires_ein_or_name() -> None:
    """Empty EIN-or-name is rejected with the dedicated message."""
    error, method = _validate_grassroots_nonprofit({"budget": "$500,000"}, DiscountVerifier())

    assert error == "Organization name or EIN is required"
    assert method is VerificationMethod.EIN_SUBMISSION


def test_validate_grassroots_nonprofit_passes_for_valid_payload() -> None:
    """Well-formed nonprofit data returns no error and the EIN_SUBMISSION method."""
    error, method = _validate_grassroots_nonprofit(
        {"einOrName": "04-1798922", "budget": "$500,000"}, DiscountVerifier()
    )

    assert error is None
    assert method is VerificationMethod.EIN_SUBMISSION


def test_validate_grassroots_nonprofit_surfaces_verifier_error() -> None:
    """Verifier rejection (e.g., budget too high) is propagated as the error message."""
    error, method = _validate_grassroots_nonprofit(
        {"einOrName": "04-1798922", "budget": "$5,000,000"}, DiscountVerifier()
    )

    assert error == "Budget must be under $2,000,000"
    assert method is VerificationMethod.EIN_SUBMISSION


def test_validate_civic_tech_worker_requires_project_url() -> None:
    """Empty project URL is rejected with the dedicated message."""
    error, method = _validate_civic_tech_worker(
        {"mission": "Building civic engagement tools that empower local communities"},
        DiscountVerifier(),
    )

    assert error == "Project URL is required"
    assert method is VerificationMethod.MISSION_STATEMENT


def test_validate_civic_tech_worker_passes_for_valid_payload() -> None:
    """Well-formed civic tech data returns no error and the MISSION_STATEMENT method."""
    error, method = _validate_civic_tech_worker(
        {
            "projectUrl": "https://github.com/example/civic-tool",
            "mission": "Building civic engagement tools that empower local communities",
        },
        DiscountVerifier(),
    )

    assert error is None
    assert method is VerificationMethod.MISSION_STATEMENT


def test_validate_civic_tech_worker_surfaces_verifier_error() -> None:
    """A short mission yields the verifier's length error."""
    error, method = _validate_civic_tech_worker(
        {"projectUrl": "https://github.com/example/civic-tool", "mission": "Too brief"},
        DiscountVerifier(),
    )

    assert error == "Mission statement should be at least 20 characters"
    assert method is VerificationMethod.MISSION_STATEMENT


@pytest.mark.asyncio
async def test_submit_discount_verification_routes_grassroots_segment(
    test_db: aiosqlite.Connection,
) -> None:
    """The grassroots branch is exercised by a valid nonprofit payload."""
    response = await submit_discount_verification(
        VerificationRequestPayload(
            segment="grassroots_nonprofit",
            organization_id="org-789",
            data={"einOrName": "04-1798922", "budget": "$500,000"},
        ),
        Response(),
        test_db,
        actor_for("user-789", "org-789"),
    )

    assert response.status == "pending"
    assert response.verification_method == "ein_submission"


@pytest.mark.asyncio
async def test_submit_discount_verification_routes_student_segment(
    test_db: aiosqlite.Connection,
) -> None:
    """The student branch is exercised by a valid school payload."""
    response = await submit_discount_verification(
        VerificationRequestPayload(
            segment="student",
            organization_id="org-303",
            data={"schoolEmail": "maya@university.edu", "schoolName": "Howard University"},
        ),
        Response(),
        test_db,
        actor_for("user-303", "org-303"),
    )

    assert response.status == "pending"
    assert response.verification_method == "school_email"


@pytest.mark.asyncio
async def test_submit_discount_verification_routes_civic_tech_segment(
    test_db: aiosqlite.Connection,
) -> None:
    """The civic-tech branch is exercised by a valid civic-tech payload."""
    response = await submit_discount_verification(
        VerificationRequestPayload(
            segment="civic_tech_worker",
            organization_id="org-101",
            data={
                "projectUrl": "https://github.com/example/civic-tool",
                "mission": "Building civic engagement tools that empower local communities",
            },
        ),
        Response(),
        test_db,
        actor_for("user-101", "org-101"),
    )

    assert response.status == "pending"
    assert response.verification_method == "mission_statement"


@pytest.mark.asyncio
async def test_submit_discount_verification_rejects_unknown_segment(
    test_db: aiosqlite.Connection,
) -> None:
    """An unknown segment value is rejected with a 400 (bypasses Pydantic via construct)."""
    payload = VerificationRequestPayload.model_construct(
        segment="something_else",  # type: ignore[arg-type]
        organization_id="org-202",
        data={},
    )

    with pytest.raises(HTTPException) as exc_info:
        await submit_discount_verification(
            payload, Response(), test_db, actor_for("user-202", "org-202")
        )

    assert exc_info.value.status_code == HTTPStatus.BAD_REQUEST
    assert "Unknown segment" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_submit_discount_verification_returns_500_on_record_creation_failure(
    monkeypatch: pytest.MonkeyPatch,
    test_db: aiosqlite.Connection,
) -> None:
    """Unexpected errors in record creation surface as a generic 500."""

    async def create_record_failure(
        conn: aiosqlite.Connection,
        record_input: DiscountVerificationCreate,
    ) -> None:
        del conn, record_input
        raise RuntimeError("storage broke")  # noqa: TRY003

    monkeypatch.setattr(DiscountVerificationCRUD, "create", create_record_failure)

    with pytest.raises(HTTPException) as exc_info:
        await submit_discount_verification(
            VerificationRequestPayload(
                segment="independent_journalist",
                organization_id="org-505",
                data={"portfolioUrl": "https://example.com/portfolio"},
            ),
            Response(),
            test_db,
            actor_for("user-505", "org-505"),
        )

    assert exc_info.value.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert "error occurred" in str(exc_info.value.detail).lower()
