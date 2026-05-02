"""Tests for discount verification API helpers and endpoint."""

from __future__ import annotations

from http import HTTPStatus

import pytest
from fastapi import HTTPException, Response

from atlas.domains.access.api import verification as verification_api_module
from atlas.domains.access.api.verification import (
    VerificationRequestPayload,
    _validate_civic_tech_worker,
    _validate_grassroots_nonprofit,
    _validate_independent_journalist,
    submit_discount_verification,
)
from atlas.domains.access.verification import DiscountVerifier, VerificationMethod


def test_validate_independent_journalist_requires_portfolio_url() -> None:
    """Independent journalist validation requires a portfolio URL."""
    error, method = _validate_independent_journalist({}, DiscountVerifier())

    assert error == "Portfolio URL is required"
    assert method is VerificationMethod.PORTFOLIO


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
async def test_submit_discount_verification_returns_pending_response() -> None:
    """Successful submissions return a pending verification payload."""
    response = await submit_discount_verification(
        VerificationRequestPayload(
            segment="independent_journalist",
            user_id="user-123",
            data={"portfolioUrl": "https://example.com/portfolio"},
        ),
        Response(),
    )

    assert response.status == "pending"
    assert response.verification_method == "portfolio"
    assert "Verification request submitted" in response.message


@pytest.mark.asyncio
async def test_submit_discount_verification_rejects_invalid_payload() -> None:
    """Invalid submissions surface a 400 with the validation error."""
    with pytest.raises(HTTPException) as exc_info:
        await submit_discount_verification(
            VerificationRequestPayload(
                segment="civic_tech_worker",
                user_id="user-456",
                data={"projectUrl": "https://github.com/example/civic-tool"},
            ),
            Response(),
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
async def test_submit_discount_verification_routes_grassroots_segment() -> None:
    """The grassroots branch is exercised by a valid nonprofit payload."""
    response = await submit_discount_verification(
        VerificationRequestPayload(
            segment="grassroots_nonprofit",
            user_id="user-789",
            data={"einOrName": "04-1798922", "budget": "$500,000"},
        ),
        Response(),
    )

    assert response.status == "pending"
    assert response.verification_method == "ein_submission"


@pytest.mark.asyncio
async def test_submit_discount_verification_routes_civic_tech_segment() -> None:
    """The civic-tech branch is exercised by a valid civic-tech payload."""
    response = await submit_discount_verification(
        VerificationRequestPayload(
            segment="civic_tech_worker",
            user_id="user-101",
            data={
                "projectUrl": "https://github.com/example/civic-tool",
                "mission": "Building civic engagement tools that empower local communities",
            },
        ),
        Response(),
    )

    assert response.status == "pending"
    assert response.verification_method == "mission_statement"


@pytest.mark.asyncio
async def test_submit_discount_verification_rejects_unknown_segment() -> None:
    """An unknown segment value is rejected with a 400 (bypasses Pydantic via construct)."""
    payload = VerificationRequestPayload.model_construct(
        segment="something_else",  # type: ignore[arg-type]
        user_id="user-202",
        data={},
    )

    with pytest.raises(HTTPException) as exc_info:
        await submit_discount_verification(payload, Response())

    assert exc_info.value.status_code == HTTPStatus.BAD_REQUEST
    assert "Unknown segment" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_submit_discount_verification_returns_500_on_record_creation_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Unexpected errors in record creation surface as a generic 500."""

    class _BoomVerifier(DiscountVerifier):
        def create_verification_record(  # type: ignore[override]  # noqa: PLR0913
            self,
            user_id: str,
            segment: object,
            method: object,
            status: object = None,
            verification_data: object = None,
            notes: object = None,
        ) -> object:
            del user_id, segment, method, status, verification_data, notes
            raise RuntimeError("storage broke")  # noqa: TRY003

    monkeypatch.setattr(verification_api_module, "DiscountVerifier", _BoomVerifier)

    with pytest.raises(HTTPException) as exc_info:
        await submit_discount_verification(
            VerificationRequestPayload(
                segment="independent_journalist",
                user_id="user-505",
                data={"portfolioUrl": "https://example.com/portfolio"},
            ),
            Response(),
        )

    assert exc_info.value.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert "error occurred" in str(exc_info.value.detail).lower()
