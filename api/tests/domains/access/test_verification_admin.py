"""Tests for admin discount verification API."""

from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING

import httpx
import pytest
from fastapi import HTTPException, Response

from atlas.config import Settings, get_settings
from atlas.domains.access.api.verification_admin import (
    VerificationUpdateRequest,
    list_verifications,
    require_discount_review_actor,
    update_verification,
)
from atlas.domains.access.models.discount_verifications import (
    DiscountVerificationCreate,
    DiscountVerificationCRUD,
)
from atlas.domains.access.principals import AuthenticatedActor
from atlas.main import create_app

if TYPE_CHECKING:
    import aiosqlite


@pytest.mark.asyncio
async def test_admin_verifications_requires_internal_auth_in_hosted_mode(
    db_url: str,
) -> None:
    """Hosted discount review data should not be public API data."""
    app = create_app()

    def override_get_settings() -> Settings:
        return Settings(
            database_url=db_url,
            deploy_mode="production",
            auth_internal_secret="internal-test-secret",
            auth_jwt_audience=["https://atlas.example.test/mcp"],
            auth_jwt_issuer="https://atlas.example.test",
            auth_api_key_introspection_url="https://atlas.example.test/api/auth/internal/api-key",
            auth_membership_verification_url=(
                "https://atlas.example.test/api/auth/internal/memberships"
            ),
        )

    app.dependency_overrides[get_settings] = override_get_settings
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/admin/verifications")

    assert response.status_code == HTTPStatus.UNAUTHORIZED


@pytest.mark.asyncio
async def test_admin_verifications_allows_allowlisted_internal_reviewers(
    db_url: str,
) -> None:
    """The app server can load discount review data for allowlisted reviewers."""
    app = create_app()

    def override_get_settings() -> Settings:
        return Settings(
            database_url=db_url,
            deploy_mode="production",
            auth_internal_secret="internal-test-secret",
            operator_allowed_emails=["reviewer@rebuildingus.org"],
            auth_jwt_audience=["https://atlas.example.test/mcp"],
            auth_jwt_issuer="https://atlas.example.test",
            auth_api_key_introspection_url="https://atlas.example.test/api/auth/internal/api-key",
            auth_membership_verification_url=(
                "https://atlas.example.test/api/auth/internal/memberships"
            ),
        )

    app.dependency_overrides[get_settings] = override_get_settings
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/admin/verifications",
            headers={
                "X-Atlas-Actor-Email": "reviewer@rebuildingus.org",
                "X-Atlas-Actor-Id": "reviewer-user",
                "X-Atlas-Internal-Secret": "internal-test-secret",
            },
        )

    assert response.status_code == HTTPStatus.OK


@pytest.mark.asyncio
async def test_admin_verifications_rejects_unlisted_internal_users(
    db_url: str,
) -> None:
    """Signed-in users who are not operators cannot review discount requests."""
    app = create_app()

    def override_get_settings() -> Settings:
        return Settings(
            database_url=db_url,
            deploy_mode="production",
            auth_internal_secret="internal-test-secret",
            operator_allowed_emails=["reviewer@rebuildingus.org"],
            auth_jwt_audience=["https://atlas.example.test/mcp"],
            auth_jwt_issuer="https://atlas.example.test",
            auth_api_key_introspection_url="https://atlas.example.test/api/auth/internal/api-key",
            auth_membership_verification_url=(
                "https://atlas.example.test/api/auth/internal/memberships"
            ),
        )

    app.dependency_overrides[get_settings] = override_get_settings
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/admin/verifications",
            headers={
                "X-Atlas-Actor-Email": "member@example.org",
                "X-Atlas-Actor-Id": "member-user",
                "X-Atlas-Internal-Secret": "internal-test-secret",
            },
        )

    assert response.status_code == HTTPStatus.FORBIDDEN


@pytest.mark.asyncio
async def test_discount_review_dependency_allows_local_actor() -> None:
    actor = AuthenticatedActor(
        user_id="local-operator",
        email="operator@atlas.test",
        auth_type="local",
        is_local=True,
    )

    allowed = await require_discount_review_actor(actor=actor, settings=Settings())

    assert allowed is actor


@pytest.mark.asyncio
async def test_discount_review_dependency_rejects_non_internal_actor() -> None:
    actor = AuthenticatedActor(
        user_id="member",
        email="member@example.org",
        auth_type="session",
    )

    with pytest.raises(HTTPException) as exc_info:
        await require_discount_review_actor(actor=actor, settings=Settings())

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Discount review access requires Atlas staff."


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
async def test_list_verifications_filters_by_organization_id(
    test_db: aiosqlite.Connection,
) -> None:
    """The admin list endpoint can return records for one billing workspace."""
    record = await DiscountVerificationCRUD.create(
        test_db,
        DiscountVerificationCreate(
            user_id="user-org",
            organization_id="org-target",
            segment="student",
            method="school_email",
            verification_data={"schoolEmail": "student@example.edu"},
            notes="Target org",
        ),
    )
    await DiscountVerificationCRUD.update_status(
        test_db,
        record.id,
        status="verified",
        notes="Verified",
    )
    await DiscountVerificationCRUD.create(
        test_db,
        DiscountVerificationCreate(
            user_id="user-other",
            organization_id="org-other",
            segment="student",
            method="school_email",
            verification_data={"schoolEmail": "other@example.edu"},
            notes="Other org",
        ),
    )

    response = await list_verifications(
        Response(),
        test_db,
        status="verified",
        organization_id="org-target",
    )

    assert response.total == 1
    assert response.organization_id_filter == "org-target"
    assert response.records[0].id == record.id


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
