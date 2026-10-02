"""Routes only machines may call accept a trusted machine credential and nothing else."""

from __future__ import annotations

import hashlib
import json
from http import HTTPStatus

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from atlas.domains.access.machine import MachinePrincipal
from atlas.platform.authz import Action, AuditLogCRUD, authorize_machine, require_machine_action

CRON_KEY = "self-hosted-cron-key-" + "z" * 40  # pragma: allowlist secret
ADMIN_KEY = "admin-app-test-key-" + "q" * 40  # pragma: allowlist secret


def _issuers() -> str:
    return json.dumps(
        [
            {
                "kind": "static_key",
                "name": "self-hosted-cron",
                "key_sha256": hashlib.sha256(CRON_KEY.encode()).hexdigest(),
                "actions": ["machine.runs.trigger_scheduled"],
            },
            {
                "kind": "static_key",
                "name": "admin-stand-in",
                "key_sha256": hashlib.sha256(ADMIN_KEY.encode()).hexdigest(),
                "actions": ["platform.discounts.review"],
            },
        ]
    )


def _request(method: str = "POST", token: str | None = None) -> Request:
    headers = [(b"authorization", f"Bearer {token}".encode())] if token else []
    return Request(
        {
            "type": "http",
            "method": method,
            "path": "/api/discovery-runs/scheduled",
            "headers": headers,
            "path_params": {},
            "query_string": b"",
        }
    )


def _principal(*actions: str, acting_for: str | None = None) -> MachinePrincipal:
    return MachinePrincipal(
        issuer_name="cron",
        kind="static_key",
        subject="cron",
        actions=frozenset(actions),
        acting_for=acting_for,
    )


def test_a_machine_holds_only_the_actions_its_issuer_grants(test_settings: object) -> None:
    granted = authorize_machine(
        _principal("machine.runs.trigger_scheduled"), Action.TRIGGER_SCHEDULED_RUNS, test_settings
    )
    refused = authorize_machine(
        _principal("machine.runs.trigger_scheduled"),
        Action.DELIVER_FIREHOSE_OBSERVATIONS,
        test_settings,
    )

    assert granted.allowed is True
    assert refused.allowed is False
    assert refused.status_code == HTTPStatus.FORBIDDEN


def test_a_machine_platform_action_does_not_exist_outside_a_managed_deployment(
    test_settings: object,
) -> None:
    test_settings.managed = False

    decision = authorize_machine(
        _principal("platform.discounts.review"), Action.DISCOUNTS_REVIEW, test_settings
    )

    assert decision.status_code == HTTPStatus.NOT_FOUND


def test_a_machine_may_perform_a_granted_platform_action_when_managed(
    test_settings: object,
) -> None:
    test_settings.managed = True

    decision = authorize_machine(
        _principal("platform.discounts.review"), Action.DISCOUNTS_REVIEW, test_settings
    )

    assert decision.allowed is True


@pytest.mark.asyncio
async def test_single_user_mode_runs_scheduled_work_without_a_credential(
    test_settings: object,
) -> None:
    test_settings.multi_user = False

    principal = await require_machine_action(Action.TRIGGER_SCHEDULED_RUNS)(
        request=_request(), settings=test_settings
    )

    assert principal.issuer_name == "local"


@pytest.mark.asyncio
@pytest.mark.parametrize("token", [None, "not-a-trusted-key"])
async def test_a_missing_or_untrusted_credential_is_refused(
    test_settings: object,
    token: str | None,
) -> None:
    test_settings.multi_user = True
    test_settings.machine_trusted_issuers = _issuers()

    with pytest.raises(HTTPException) as exc:
        await require_machine_action(Action.TRIGGER_SCHEDULED_RUNS)(
            request=_request(token=token), settings=test_settings
        )

    assert exc.value.status_code == HTTPStatus.UNAUTHORIZED
    assert exc.value.detail == "A trusted machine credential is required."


@pytest.mark.asyncio
async def test_a_trusted_machine_is_recorded_when_it_triggers_scheduled_work(
    test_db: object,
    test_settings: object,
) -> None:
    test_settings.multi_user = True
    test_settings.machine_trusted_issuers = _issuers()

    principal = await require_machine_action(Action.TRIGGER_SCHEDULED_RUNS)(
        request=_request(token=CRON_KEY), settings=test_settings
    )

    assert principal.issuer_name == "self-hosted-cron"
    [entry] = await AuditLogCRUD.list_recent(test_db, limit=10)
    assert entry.plane == "machine"
    assert entry.actor_id == "self-hosted-cron:self-hosted-cron"
    assert entry.auth_type == "machine:static_key"
    assert entry.allowed is True


@pytest.mark.asyncio
async def test_a_trusted_machine_without_the_action_is_refused_and_recorded(
    test_db: object,
    test_settings: object,
) -> None:
    test_settings.multi_user = True
    test_settings.machine_trusted_issuers = _issuers()

    with pytest.raises(HTTPException) as exc:
        await require_machine_action(Action.TRIGGER_SCHEDULED_RUNS)(
            request=_request(token=ADMIN_KEY), settings=test_settings
        )

    assert exc.value.status_code == HTTPStatus.FORBIDDEN
    [entry] = await AuditLogCRUD.list_recent(test_db, limit=10)
    assert entry.allowed is False
    assert entry.actor_id == "admin-stand-in:admin-stand-in"


@pytest.mark.asyncio
async def test_a_machine_acting_for_an_operator_records_who(
    test_db: object,
    test_settings: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    test_settings.multi_user = True
    test_settings.managed = True
    monkeypatch.setattr(
        "atlas.platform.authz.dependency.verify_machine_token",
        lambda _token, _issuers: _principal(
            "platform.discounts.review", acting_for="willie@rebuildingus.org"
        ),
    )

    await require_machine_action(Action.DISCOUNTS_REVIEW)(
        request=_request(method="PATCH", token="anything"), settings=test_settings
    )

    [entry] = await AuditLogCRUD.list_recent(test_db, limit=10)
    assert entry.actor_email == "willie@rebuildingus.org"


@pytest.mark.asyncio
async def test_a_machine_read_is_not_recorded(test_db: object, test_settings: object) -> None:
    test_settings.multi_user = True
    test_settings.machine_trusted_issuers = _issuers()

    await require_machine_action(Action.TRIGGER_SCHEDULED_RUNS)(
        request=_request(method="GET", token=CRON_KEY), settings=test_settings
    )

    assert await AuditLogCRUD.list_recent(test_db, limit=10) == []


def test_the_guard_records_which_action_it_protects() -> None:
    guard = require_machine_action(Action.TRIGGER_SCHEDULED_RUNS)

    assert guard.authz_action is Action.TRIGGER_SCHEDULED_RUNS
