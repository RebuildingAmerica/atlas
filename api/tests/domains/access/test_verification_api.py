"""Tests for discount verification API helpers and endpoint."""

from __future__ import annotations

from http import HTTPStatus

import pytest
from fastapi import HTTPException, Response

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
