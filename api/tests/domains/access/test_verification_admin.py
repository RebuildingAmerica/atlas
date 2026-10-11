"""The platform admin's discount review routes."""

from __future__ import annotations

import json
from http import HTTPStatus
from typing import TYPE_CHECKING

import httpx
import pytest
from fastapi import HTTPException, Response

from atlas.config import Settings, get_settings
from atlas.domains.access import discount_review_notice
from atlas.domains.access.api import verification_admin
from atlas.domains.access.api.verification_admin import (
    UNSENT_RESULT_DETAIL,
    VerificationUpdateRequest,
    list_verifications,
    update_verification,
)
from atlas.domains.access.discount_review_notice import REVIEW_RESULT_PATH
from atlas.domains.access.models.discount_verifications import (
    DiscountVerificationCreate,
    DiscountVerificationCRUD,
)
from atlas.main import create_app
from atlas.platform.authz import Action, AuditLogCRUD
from tests.support.app_assertions import sign_app_assertion
from tests.support.platform_admin import (
    OPERATOR_EMAIL,
    managed_app,
    platform_headers,
    platform_settings,
)

if TYPE_CHECKING:
    import aiosqlite


REVIEW_LIST = "/api/platform/discount-verifications"


async def test_discount_reviews_need_the_admin_app_in_a_managed_deployment(
    monkeypatch: pytest.MonkeyPatch, db_url: str
) -> None:
    """Discount review data is never public API data."""
    app = managed_app(monkeypatch, platform_settings(db_url))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(REVIEW_LIST)

    assert response.status_code == HTTPStatus.UNAUTHORIZED


async def test_the_admin_app_lists_discount_reviews_for_a_platform_operator(
    monkeypatch: pytest.MonkeyPatch, db_url: str
) -> None:
    app = managed_app(monkeypatch, platform_settings(db_url))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(REVIEW_LIST, headers=platform_headers())

    assert response.status_code == HTTPStatus.OK
    assert response.json()["records"] == []


async def test_an_atlas_app_operator_cannot_review_discounts(
    monkeypatch: pytest.MonkeyPatch, db_url: str
) -> None:
    """Signing in to the Atlas app, even as the instance operator, grants no platform action."""
    settings = platform_settings(db_url, operator_allowed_emails=[OPERATOR_EMAIL])
    app = managed_app(monkeypatch, settings)
    assertion = sign_app_assertion(
        user_id="operator-user",
        email=OPERATOR_EMAIL,
        issuer="https://atlas.example.test/api/auth",
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(REVIEW_LIST, headers={"X-Atlas-Actor-Assertion": assertion})

    assert response.status_code == HTTPStatus.UNAUTHORIZED


async def test_a_self_hosted_deployment_has_no_discount_reviews(db_url: str) -> None:
    """Without ATLAS_MANAGED the platform routes are not mounted at all."""
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: platform_settings(db_url, managed=False)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(REVIEW_LIST, headers=platform_headers())

    assert response.status_code == HTTPStatus.NOT_FOUND


async def test_approving_a_request_emails_the_applicant_through_the_app(
    monkeypatch: pytest.MonkeyPatch, test_db: aiosqlite.Connection, db_url: str
) -> None:
    record = await DiscountVerificationCRUD.create(
        test_db,
        DiscountVerificationCreate(
            user_id="user-123",
            organization_id="org-123",
            segment="student",
            method="school_email",
            verification_data={"schoolEmail": "student@example.edu"},
        ),
    )
    sent: list[dict[str, object]] = []

    def _app(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == f"https://atlas.example.test{REVIEW_RESULT_PATH}"
        callback_secret = "callback-test-secret"  # pragma: allowlist secret
        assert request.headers["X-Atlas-Callback-Secret"] == callback_secret
        sent.append(json.loads(request.content))
        return httpx.Response(204)

    real_client = httpx.AsyncClient
    app = managed_app(monkeypatch, platform_settings(db_url))
    monkeypatch.setattr(
        discount_review_notice.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(_app), **kwargs),
    )
    transport = httpx.ASGITransport(app=app)
    async with real_client(transport=transport, base_url="http://test") as client:
        response = await client.patch(
            f"{REVIEW_LIST}/{record.id}",
            json={"status": "verified", "notes": "Enrollment confirmed"},
            headers=platform_headers(),
        )

    assert response.status_code == HTTPStatus.OK
    assert sent == [{"segment": "student", "status": "verified", "user_id": "user-123"}]
    entries = await AuditLogCRUD.list_recent(test_db, limit=5, action=Action.DISCOUNTS_REVIEW)
    assert [(entry.plane, entry.actor_email, entry.allowed) for entry in entries] == [
        ("staff", OPERATOR_EMAIL, True)
    ]


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


class _Notices:
    """Records the review emails the API asks the app to send."""

    def __init__(self, *, fail: bool = False) -> None:
        self.sent: list[tuple[str, str, str]] = []
        self.fail = fail

    async def __call__(
        self, _settings: Settings, *, user_id: str, segment: str, status: str
    ) -> None:
        if self.fail:
            msg = "app unreachable"
            raise httpx.ConnectError(msg)
        self.sent.append((user_id, segment, status))


async def _journalist_request(test_db: aiosqlite.Connection) -> str:
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
    return record.id


async def test_update_verification_marks_record_verified(
    monkeypatch: pytest.MonkeyPatch, test_db: aiosqlite.Connection
) -> None:
    """Reviewers can approve a pending verification request, and the applicant hears."""
    notices = _Notices()
    monkeypatch.setattr(verification_admin, "notify_discount_review_result", notices)
    record_id = await _journalist_request(test_db)

    response = await update_verification(
        Response(),
        record_id,
        VerificationUpdateRequest(status="verified", notes="Published byline confirmed"),
        test_db,
        platform_settings(),
    )

    assert response.status == "verified"
    assert response.record.id == record_id
    assert response.record.verified_at is not None
    assert response.record.notes == "Published byline confirmed"
    assert notices.sent == [("user-123", "independent_journalist", "verified")]


async def test_a_decision_stays_saved_when_the_applicant_cannot_be_emailed(
    monkeypatch: pytest.MonkeyPatch, test_db: aiosqlite.Connection
) -> None:
    monkeypatch.setattr(verification_admin, "notify_discount_review_result", _Notices(fail=True))
    record_id = await _journalist_request(test_db)

    with pytest.raises(HTTPException) as exc_info:
        await update_verification(
            Response(),
            record_id,
            VerificationUpdateRequest(status="rejected", notes="No byline"),
            test_db,
            platform_settings(),
        )

    assert exc_info.value.status_code == HTTPStatus.BAD_GATEWAY
    assert exc_info.value.detail == UNSENT_RESULT_DETAIL
    saved = await DiscountVerificationCRUD.get_by_id(test_db, record_id)
    assert saved is not None
    assert saved.status == "rejected"


async def test_update_verification_returns_404_for_missing_record(
    monkeypatch: pytest.MonkeyPatch, test_db: aiosqlite.Connection
) -> None:
    """Updating an unknown verification id returns a clear 404 and emails no one."""
    notices = _Notices()
    monkeypatch.setattr(verification_admin, "notify_discount_review_result", notices)

    with pytest.raises(HTTPException) as exc_info:
        await update_verification(
            Response(),
            "missing-record",
            VerificationUpdateRequest(status="rejected", notes="No evidence"),
            test_db,
            platform_settings(),
        )

    assert exc_info.value.status_code == HTTPStatus.NOT_FOUND
    assert exc_info.value.detail == "Verification record not found"
    assert notices.sent == []
