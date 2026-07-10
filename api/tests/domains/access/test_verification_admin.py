"""Tests for admin discount verification API."""

from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING

import pytest
from fastapi import HTTPException, Response

from atlas.domains.access.api.verification_admin import (
    VerificationUpdateRequest,
    list_verifications,
    update_verification,
)
from atlas.domains.access.models.discount_verifications import (
    DiscountVerificationCreate,
    DiscountVerificationCRUD,
)

if TYPE_CHECKING:
    import aiosqlite


@pytest.mark.asyncio
async def test_list_verifications_returns_persisted_filtered_records(
    test_db: aiosqlite.Connection,
) -> None:
    """The admin list endpoint returns durable verification records."""
    await DiscountVerificationCRUD.create(
        test_db,
        DiscountVerificationCreate(
            user_id="user-pending",
            organization_id="org-pending",
            segment="civic_tech_worker",
            method="mission_statement",
            verification_data={"projectUrl": "https://example.org/tool"},
            notes="Pending review",
        ),
    )
    await DiscountVerificationCRUD.create(
        test_db,
        DiscountVerificationCreate(
            user_id="user-other",
            organization_id="org-other",
            segment="student",
            method="school_email",
            verification_data={"schoolEmail": "student@example.edu"},
            notes="Other segment",
        ),
    )

    response = await list_verifications(
        Response(),
        test_db,
        status="pending",
        segment="civic_tech_worker",
    )

    assert response.total == 1
    assert response.status_filter == "pending"
    assert response.segment_filter == "civic_tech_worker"
    assert response.records[0].user_id == "user-pending"
    assert response.records[0].organization_id == "org-pending"
    assert response.records[0].segment == "civic_tech_worker"
    assert response.records[0].verification_data == {"projectUrl": "https://example.org/tool"}


@pytest.mark.asyncio
async def test_update_verification_marks_record_verified(
    test_db: aiosqlite.Connection,
) -> None:
    """Reviewers can approve a pending verification request."""
    record = await DiscountVerificationCRUD.create(
        test_db,
        DiscountVerificationCreate(
            user_id="user-123",
            organization_id="org-123",
            segment="independent_journalist",
            method="portfolio",
            verification_data={"portfolioUrl": "https://example.org/byline"},
            notes="Pending review",
        ),
    )

    response = await update_verification(
        Response(),
        record.id,
        VerificationUpdateRequest(status="verified", notes="Published byline confirmed"),
        test_db,
    )

    assert response.status == "verified"
    assert response.record.id == record.id
    assert response.record.verified_at is not None
    assert response.record.notes == "Published byline confirmed"


@pytest.mark.asyncio
async def test_update_verification_returns_404_for_missing_record(
    test_db: aiosqlite.Connection,
) -> None:
    """Updating an unknown verification id returns a clear 404."""
    with pytest.raises(HTTPException) as exc_info:
        await update_verification(
            Response(),
            "missing-record",
            VerificationUpdateRequest(status="rejected", notes="No evidence"),
            test_db,
        )

    assert exc_info.value.status_code == HTTPStatus.NOT_FOUND
    assert exc_info.value.detail == "Verification record not found"
