"""Anonymous rate-limit tests for credential-backed requests."""

from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING
from unittest.mock import patch

import pytest

from atlas.domains.access import ApiKeyPrincipal
from atlas.domains.access.membership import MembershipResult
from tests.support.anonymous_rate_limit import READ_PATH, READ_PATH_GROUP, _client, _settings

if TYPE_CHECKING:
    from atlas.platform.config import Settings


@pytest.mark.asyncio
async def test_valid_jwt_bypasses_and_fake_bearer_counts_as_anonymous(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Only verified OAuth JWTs should bypass anonymous buckets."""
    settings = _settings(db_url, anonymous_rate_limit_reads_per_minute=1)

    def fake_verify(authorization: str | None, **_kwargs: object) -> dict[str, object] | None:
        if authorization == "Bearer valid-token":
            return {"sub": "user-123"}
        return None

    monkeypatch.setattr(
        "atlas.platform.http.anonymous_rate_limit.verify_bearer_jwt",
        fake_verify,
    )

    async for client in _client(settings):
        valid_responses = [
            await client.get(READ_PATH, headers={"Authorization": "Bearer valid-token"})
            for _ in range(2)
        ]
        first_fake = await client.get(READ_PATH, headers={"Authorization": "Bearer fake"})
        second_fake = await client.get(READ_PATH, headers={"Authorization": "Bearer fake"})

    assert [response.status_code for response in valid_responses] == [
        HTTPStatus.OK,
        HTTPStatus.OK,
    ]
    assert first_fake.status_code == HTTPStatus.OK
    assert second_fake.status_code == HTTPStatus.TOO_MANY_REQUESTS


@pytest.mark.asyncio
async def test_fake_api_key_is_pre_auth_limited_before_repeated_introspection(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Forged API keys should not force repeated upstream introspection work."""
    settings = _settings(
        db_url,
        deploy_mode="production",
        auth_jwt_issuer="https://atlas.test",
        auth_jwt_audience=["https://atlas.test/mcp", "https://api.atlas.test"],
        auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
        auth_membership_verification_url="https://atlas.test",
        anonymous_rate_limit_reads_per_minute=100,
        anonymous_credential_rate_limit_per_minute=1,
        anonymous_credential_rate_limit_total_per_hour=100,
    )
    attempted_keys: list[str] = []

    async def fake_verify_api_key(api_key: str, _settings: Settings) -> ApiKeyPrincipal | None:
        attempted_keys.append(api_key)
        return None

    monkeypatch.setattr(
        "atlas.platform.http.anonymous_rate_limit.verify_api_key",
        fake_verify_api_key,
        raising=False,
    )

    with patch("atlas.platform.http.anonymous_rate_limit.time.monotonic", return_value=0.0):
        async for client in _client(settings):
            first = await client.get(READ_PATH, headers={"X-API-Key": "fake-key"})
            blocked = await client.get(READ_PATH, headers={"X-API-Key": "fake-key"})

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert blocked.headers["x-ratelimit-limit"] == "1"
    assert attempted_keys == ["fake-key"]
    invalid_records = [
        record
        for record in caplog.records
        if getattr(record, "event", "") == "invalid_credential_attempt"
    ]
    assert len(invalid_records) == 1
    assert invalid_records[0].credential_kind == "api_key"
    assert invalid_records[0].path_group == READ_PATH_GROUP
    assert isinstance(invalid_records[0].client_key_hash, str)
    assert "fake-key" not in caplog.text


@pytest.mark.asyncio
async def test_fake_api_key_spends_anonymous_quota_after_failed_verification(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Forged API keys should still spend anonymous public quota."""
    settings = _settings(
        db_url,
        deploy_mode="production",
        auth_jwt_issuer="https://atlas.test",
        auth_jwt_audience=["https://atlas.test/mcp", "https://api.atlas.test"],
        auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
        auth_membership_verification_url="https://atlas.test",
        anonymous_rate_limit_reads_per_minute=1,
        anonymous_credential_rate_limit_per_minute=10,
        anonymous_credential_rate_limit_total_per_hour=100,
    )
    attempted_keys: list[str] = []

    async def fake_verify_api_key(api_key: str, _settings: Settings) -> ApiKeyPrincipal | None:
        attempted_keys.append(api_key)
        return None

    monkeypatch.setattr(
        "atlas.platform.http.anonymous_rate_limit.verify_api_key",
        fake_verify_api_key,
        raising=False,
    )

    with patch("atlas.platform.http.anonymous_rate_limit.time.monotonic", return_value=0.0):
        async for client in _client(settings):
            first = await client.get(READ_PATH, headers={"X-API-Key": "fake-key"})
            blocked = await client.get(READ_PATH, headers={"X-API-Key": "fake-key"})

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert blocked.headers["x-ratelimit-limit"] == "1"
    assert attempted_keys == ["fake-key"]


@pytest.mark.asyncio
async def test_fake_bearer_is_pre_auth_limited_before_repeated_jwt_verification(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Forged bearer tokens should not force repeated JWT verification work."""
    settings = _settings(
        db_url,
        deploy_mode="production",
        auth_jwt_issuer="https://atlas.test",
        auth_jwt_audience=["https://atlas.test/mcp", "https://api.atlas.test"],
        auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
        auth_membership_verification_url="https://atlas.test",
        anonymous_rate_limit_reads_per_minute=100,
        anonymous_credential_rate_limit_per_minute=1,
        anonymous_credential_rate_limit_total_per_hour=100,
    )
    attempted_authorizations: list[str | None] = []

    def fake_verify_bearer_jwt(
        authorization: str | None,
        **_kwargs: object,
    ) -> dict[str, object] | None:
        attempted_authorizations.append(authorization)
        return None

    monkeypatch.setattr(
        "atlas.platform.http.anonymous_rate_limit.verify_bearer_jwt",
        fake_verify_bearer_jwt,
    )

    async for client in _client(settings):
        first = await client.get(READ_PATH, headers={"Authorization": "Bearer fake"})
        blocked = await client.get(READ_PATH, headers={"Authorization": "Bearer fake"})

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert blocked.headers["x-ratelimit-limit"] == "1"
    assert attempted_authorizations == ["Bearer fake"]
    invalid_records = [
        record
        for record in caplog.records
        if getattr(record, "event", "") == "invalid_credential_attempt"
    ]
    assert len(invalid_records) == 1
    assert invalid_records[0].credential_kind == "bearer"
    assert invalid_records[0].path_group == READ_PATH_GROUP
    assert "Bearer fake" not in caplog.text


@pytest.mark.asyncio
async def test_valid_api_key_bypasses_anonymous_limits(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Valid API-key integrations should not be treated as anonymous wrappers."""
    settings = _settings(
        db_url,
        deploy_mode="production",
        auth_jwt_issuer="https://atlas.test",
        auth_jwt_audience=["https://atlas.test/mcp", "https://api.atlas.test"],
        auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
        auth_membership_verification_url="https://atlas.test",
        anonymous_credential_rate_limit_per_minute=10,
        anonymous_credential_rate_limit_total_per_hour=100,
        anonymous_rate_limit_writes_per_minute=1,
    )

    async def fake_verify_api_key(api_key: str, _settings: Settings) -> ApiKeyPrincipal | None:
        assert api_key == "atlas_test_key"
        return ApiKeyPrincipal(
            key_id="key_123",
            name="Test Key",
            permissions={"discovery": ["write"]},
            user_id="user_123",
            user_email="operator@example.com",
            org_id="org_123",
        )

    async def fake_verify_org_membership(
        user_id: str,
        org_id: str,
        _settings: Settings,
    ) -> MembershipResult:
        assert user_id == "user_123"
        assert org_id == "org_123"
        return MembershipResult(
            role="owner",
            slug="org-123",
            name="Org 123",
            workspace_type="team",
            active_products=["atlas_team"],
        )

    monkeypatch.setattr(
        "atlas.platform.http.anonymous_rate_limit.verify_api_key",
        fake_verify_api_key,
        raising=False,
    )
    monkeypatch.setattr("atlas.domains.access.dependencies.verify_api_key", fake_verify_api_key)
    monkeypatch.setattr(
        "atlas.domains.access.dependencies.verify_org_membership",
        fake_verify_org_membership,
    )

    payload = {
        "location_query": "Gary, IN",
        "state": "IN",
        "issue_areas": ["housing_affordability"],
    }
    async for client in _client(settings):
        first = await client.post(
            "/api/discovery-runs",
            headers={"X-API-Key": "atlas_test_key"},
            json=payload,
        )
        second = await client.post(
            "/api/discovery-runs",
            headers={"X-API-Key": "atlas_test_key"},
            json=payload,
        )

    assert first.status_code == HTTPStatus.ACCEPTED
    assert second.status_code == HTTPStatus.ACCEPTED
