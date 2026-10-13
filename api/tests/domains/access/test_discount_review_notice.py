"""The API asks the app to email an applicant once their discount request is decided."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from atlas.domains.access import discount_review_notice
from atlas.domains.access.discount_review_notice import notify_discount_review_result
from tests.support.platform_admin import platform_settings

CALLBACK_TEST_SECRET = "callback-test-secret"  # pragma: allowlist secret


def _app_answers(
    monkeypatch: pytest.MonkeyPatch, status_code: int, seen: list[httpx.Request]
) -> None:
    real_client = httpx.AsyncClient

    def _handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status_code)

    def _client(**kwargs: Any) -> httpx.AsyncClient:
        return real_client(transport=httpx.MockTransport(_handler), **kwargs)

    monkeypatch.setattr(discount_review_notice.httpx, "AsyncClient", _client)


async def test_posts_the_decision_to_the_app_with_the_callback_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[httpx.Request] = []
    _app_answers(monkeypatch, 204, seen)
    settings = platform_settings(
        auth_membership_verification_url="https://atlas.example.test/",
    )

    await notify_discount_review_result(
        settings, user_id="user-1", segment="student", status="rejected"
    )

    [request] = seen
    assert (
        str(request.url) == "https://atlas.example.test/api/auth/internal/discount-review-results"
    )
    assert (
        request.headers["X-Atlas-Callback-Secret"] == CALLBACK_TEST_SECRET
    )  # pragma: allowlist secret
    assert json.loads(request.content) == {
        "segment": "student",
        "status": "rejected",
        "user_id": "user-1",
    }


async def test_raises_when_the_app_does_not_confirm_the_email(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    _app_answers(monkeypatch, 500, [])

    with pytest.raises(httpx.HTTPStatusError):
        await notify_discount_review_result(
            platform_settings(), user_id="user-1", segment="student", status="verified"
        )

    assert "did not confirm a discount review email" in caplog.text
