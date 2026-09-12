"""Anonymous limits applied to bearer tokens and JWTs."""

from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING

import pytest

from atlas.domains.access import ApiKeyPrincipal
from tests.support.anonymous_rate_limit import READ_PATH, READ_PATH_GROUP, _client, _settings

if TYPE_CHECKING:
    from atlas.platform.config import Settings


@pytest.mark.asyncio
async def test_valid_jwt_bypasses_and_fake_bearer_counts_as_anonymous(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Only verified OAuth JWTs should bypass anonymous buckets."""
    settings = _settings(
        db_url,
        anonymous_rate_limit_reads_per_minute=1,
        anonymous_credential_rate_limit_per_minute=1,
    )

    attempted_authorizations: list[str | None] = []

    def fake_verify(authorization: str | None, **_kwargs: object) -> dict[str, object] | None:
        attempted_authorizations.append(authorization)
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
            for _ in range(3)
        ]
        first_fake = await client.get(READ_PATH, headers={"Authorization": "Bearer fake"})
        second_fake = await client.get(READ_PATH, headers={"Authorization": "Bearer fake"})

    assert [response.status_code for response in valid_responses] == [
        HTTPStatus.OK,
        HTTPStatus.OK,
        HTTPStatus.OK,
    ]
    assert first_fake.status_code == HTTPStatus.OK
    assert second_fake.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert attempted_authorizations == [
        "Bearer valid-token",
        "Bearer valid-token",
        "Bearer valid-token",
        "Bearer fake",
    ]


@pytest.mark.asyncio
async def test_fake_bearer_is_pre_auth_limited_before_repeated_jwt_verification(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Forged bearer tokens should not force repeated JWT verification work."""
    settings = _settings(
        db_url,
        multi_user=True,
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
async def test_rotating_fake_bearers_are_blocked_before_additional_verification(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Distinct forged bearer values should not bypass the verification budget."""
    settings = _settings(
        db_url,
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
        first = await client.get(READ_PATH, headers={"Authorization": "Bearer fake-1"})
        blocked = await client.get(READ_PATH, headers={"Authorization": "Bearer fake-2"})

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert attempted_authorizations == ["Bearer fake-1"]


@pytest.mark.asyncio
async def test_mixed_credentials_are_rejected_without_verification(
    db_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ambiguous auth schemes should not amplify either credential verifier."""
    settings = _settings(
        db_url,
        multi_user=True,
        auth_jwt_issuer="https://atlas.test",
        auth_jwt_audience=["https://atlas.test/mcp", "https://api.atlas.test"],
        auth_api_key_introspection_url="https://atlas.test/api/auth/internal/api-key",
        auth_membership_verification_url="https://atlas.test",
        anonymous_rate_limit_reads_per_minute=100,
        anonymous_credential_rate_limit_per_minute=1,
        anonymous_credential_rate_limit_total_per_hour=100,
    )
    attempted_keys: list[str] = []
    attempted_authorizations: list[str | None] = []

    async def fake_verify_api_key(api_key: str, _settings: Settings) -> ApiKeyPrincipal | None:
        attempted_keys.append(api_key)
        return None

    def fake_verify_bearer_jwt(
        authorization: str | None,
        **_kwargs: object,
    ) -> dict[str, object] | None:
        attempted_authorizations.append(authorization)
        return {"sub": "user-123"}

    monkeypatch.setattr(
        "atlas.platform.http.anonymous_rate_limit.verify_api_key",
        fake_verify_api_key,
    )
    monkeypatch.setattr(
        "atlas.platform.http.anonymous_rate_limit.verify_bearer_jwt",
        fake_verify_bearer_jwt,
    )

    headers = {"X-API-Key": "fake-key", "Authorization": "Bearer valid-token"}
    async for client in _client(settings):
        first = await client.get(READ_PATH, headers=headers)
        blocked = await client.get(READ_PATH, headers=headers)

    assert first.status_code == HTTPStatus.OK
    assert blocked.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert attempted_keys == []
    assert attempted_authorizations == []
