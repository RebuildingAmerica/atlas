"""Every operator decision that changes data leaves a permanent, append-only record."""

from __future__ import annotations

import json
from http import HTTPStatus

import pytest
from fastapi import HTTPException

from atlas.domains.access.principals import AuthenticatedActor
from atlas.models.database import _load_postgres_schema, _load_sqlite_schema
from atlas.platform.authz import Action, AuditLogCRUD, AuditRecord, actor_plane, require_action
from tests.support.app_assertions import sign_app_assertion
from tests.support.authz_requests import guard_request
from tests.support.staff_auth import STAFF_EMAIL, enable_staff_auth

OPERATOR = "editor@rebuildingus.org"


def _actor(*, email: str = OPERATOR, auth_type: str = "internal") -> AuthenticatedActor:
    return AuthenticatedActor(
        user_id="user_editor", email=email, auth_type=auth_type, account_ready=True
    )


def _record(**overrides: object) -> AuditRecord:
    values: dict[str, object] = {
        "plane": "customer",
        "actor_id": "user_editor",
        "actor_email": OPERATOR,
        "auth_type": "internal",
        "action": Action.CLAIMS_REVIEW,
        "allowed": True,
        "status_code": HTTPStatus.OK,
        "method": "POST",
        "route": "/api/profiles/claims/review/{claim_id}/approve",
        "target": {"claim_id": "claim_1"},
        "reason": None,
        "request_id": "req-1",
    }
    values.update(overrides)
    return AuditRecord(**values)  # type: ignore[arg-type]


def test_both_schemas_define_an_append_only_audit_log() -> None:
    sqlite_schema = _load_sqlite_schema()
    postgres_schema = _load_postgres_schema()

    for schema in (sqlite_schema, postgres_schema):
        assert "CREATE TABLE IF NOT EXISTS audit_log" in schema
        assert "audit_log is append-only" in schema
    assert "BEFORE UPDATE ON audit_log" in sqlite_schema
    assert "BEFORE DELETE ON audit_log" in sqlite_schema
    assert "BEFORE UPDATE OR DELETE ON audit_log" in postgres_schema
    assert "BEFORE TRUNCATE ON audit_log" in postgres_schema


@pytest.mark.asyncio
async def test_a_recorded_decision_reads_back_exactly(test_db: object) -> None:
    entry_id = await AuditLogCRUD.record(test_db, _record())

    entries = await AuditLogCRUD.list_recent(test_db, limit=10)

    assert [entry.id for entry in entries] == [entry_id]
    entry = entries[0]
    assert entry.action == "instance.claims.review"
    assert entry.allowed is True
    assert entry.status_code == HTTPStatus.OK
    assert entry.plane == "customer"
    assert entry.actor_email == OPERATOR
    assert entry.route == "/api/profiles/claims/review/{claim_id}/approve"
    assert entry.target == {"claim_id": "claim_1"}
    assert entry.request_id == "req-1"
    assert entry.reason is None
    assert entry.occurred_at


@pytest.mark.asyncio
async def test_recent_entries_come_newest_first_and_filter_by_action(test_db: object) -> None:
    first = await AuditLogCRUD.record(test_db, _record())
    second = await AuditLogCRUD.record(
        test_db, _record(action=Action.SCHEDULES_WRITE, route="/api/discovery-schedules")
    )

    newest_first = await AuditLogCRUD.list_recent(test_db, limit=10)
    schedules = await AuditLogCRUD.list_recent(test_db, limit=10, action=Action.SCHEDULES_WRITE)

    assert [entry.id for entry in newest_first] == [second, first]
    assert [entry.id for entry in schedules] == [second]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE audit_log SET reason = 'rewritten'",
        "DELETE FROM audit_log",
    ],
)
async def test_recorded_decisions_cannot_be_changed_or_erased(
    test_db: object,
    statement: str,
) -> None:
    await AuditLogCRUD.record(test_db, _record())

    with pytest.raises(Exception, match="audit_log is append-only"):
        await test_db.execute(statement)
    await test_db.rollback()

    assert len(await AuditLogCRUD.list_recent(test_db, limit=10)) == 1


def test_planes_name_where_the_caller_signed_in() -> None:
    local = AuthenticatedActor(user_id="local", email="", auth_type="local", is_local=True)

    assert actor_plane(local) == "local"
    for auth_type in ("internal", "api_key", "oauth_jwt"):
        assert actor_plane(_actor(auth_type=auth_type)) == "customer"


@pytest.mark.asyncio
async def test_an_allowed_change_is_recorded_before_it_runs(
    test_db: object,
    test_settings: object,
) -> None:
    test_settings.instance_operator_emails = [OPERATOR]
    request = guard_request(
        "POST", "/api/profiles/claims/review/claim_9/approve", {"claim_id": "claim_9"}
    )

    actor = _actor()
    result = await require_action(Action.CLAIMS_REVIEW)(
        request=request, actor=actor, settings=test_settings
    )

    assert result is actor
    [entry] = await AuditLogCRUD.list_recent(test_db, limit=10)
    assert entry.allowed is True
    assert entry.action == "instance.claims.review"
    assert entry.method == "POST"
    assert entry.target == {"claim_id": "claim_9"}
    assert entry.actor_email == OPERATOR


@pytest.mark.asyncio
async def test_a_refused_change_is_recorded_with_the_refusal(
    test_db: object,
    test_settings: object,
) -> None:
    test_settings.instance_operator_emails = [OPERATOR]
    request = guard_request("POST", "/api/review-queue/item_1/approve", {"item_id": "item_1"})

    with pytest.raises(HTTPException) as exc:
        await require_action(Action.REVIEW_QUEUE_DECIDE)(
            request=request, actor=_actor(email="visitor@example.org"), settings=test_settings
        )

    assert exc.value.status_code == HTTPStatus.FORBIDDEN
    [entry] = await AuditLogCRUD.list_recent(test_db, limit=10)
    assert entry.allowed is False
    assert entry.status_code == HTTPStatus.FORBIDDEN
    assert entry.reason == "Editorial review requires Atlas staff."
    assert entry.actor_email == "visitor@example.org"


@pytest.mark.asyncio
async def test_reads_are_not_recorded(test_db: object, test_settings: object) -> None:
    test_settings.instance_operator_emails = [OPERATOR]

    await require_action(Action.REVIEW_QUEUE_READ)(
        request=guard_request("GET", "/api/review-queue", {}),
        actor=_actor(),
        settings=test_settings,
    )

    assert await AuditLogCRUD.list_recent(test_db, limit=10) == []


@pytest.mark.asyncio
async def test_a_change_that_cannot_be_recorded_does_not_run(test_settings: object) -> None:
    test_settings.instance_operator_emails = [OPERATOR]
    test_settings.database_url = "sqlite:///nonexistent-directory/atlas.db"

    with pytest.raises(HTTPException) as exc:
        await require_action(Action.SCHEDULES_WRITE)(
            request=guard_request("POST", "/api/discovery-schedules", {}),
            actor=_actor(),
            settings=test_settings,
        )

    assert exc.value.status_code == HTTPStatus.SERVICE_UNAVAILABLE


@pytest.mark.asyncio
async def test_an_operator_approval_through_the_api_leaves_an_entry(
    test_client: object,
    test_db: object,
    test_settings: object,
) -> None:
    headers = enable_staff_auth(test_settings)

    denied = await test_client.post("/api/review-queue/missing/approve", headers=headers.ordinary)
    attempted = await test_client.post("/api/review-queue/missing/approve", headers=headers.staff)

    assert denied.status_code == HTTPStatus.FORBIDDEN
    assert attempted.status_code == HTTPStatus.NOT_FOUND
    entries = await AuditLogCRUD.list_recent(test_db, limit=10)
    assert [(entry.allowed, entry.actor_email) for entry in entries] == [
        (True, STAFF_EMAIL.upper()),
        (False, "visitor@example.org"),
    ]
    assert {entry.route for entry in entries} == {"/api/review-queue/{item_id}/approve"}
    assert json.loads(json.dumps(entries[0].target)) == {"item_id": "missing"}


@pytest.mark.asyncio
async def test_a_missing_platform_surface_is_not_recorded(
    test_db: object,
    test_settings: object,
) -> None:
    test_settings.instance_operator_emails = [OPERATOR]
    test_settings.managed = False

    with pytest.raises(HTTPException) as exc:
        await require_action(Action.DISCOUNTS_REVIEW)(
            request=guard_request(
                "PATCH", "/api/admin/verifications/v1", {"verification_id": "v1"}
            ),
            actor=_actor(),
            settings=test_settings,
        )

    assert exc.value.status_code == HTTPStatus.NOT_FOUND
    assert await AuditLogCRUD.list_recent(test_db, limit=10) == []


@pytest.mark.parametrize(
    ("path", "template", "expected"),
    [
        ("/api/review-queue/a1/approve", "/review-queue/{item_id}/approve", None),
        ("/review-queue/a1/approve", "/review-queue/{item_id}/approve", None),
        ("/short", "/a/{b}/c", "/short"),
    ],
)
def test_route_templates_include_the_prefixes_of_enclosing_routers(
    path: str,
    template: str,
    expected: str | None,
) -> None:
    from types import SimpleNamespace

    from atlas.platform.authz.dependency import route_template

    request = guard_request("POST", path)
    request.scope["route"] = SimpleNamespace(path_format=template)

    assert route_template(request) == (expected or path.replace("a1", "{item_id}"))


@pytest.mark.asyncio
async def test_an_operator_session_without_a_passkey_cannot_approve(
    test_client: object,
    test_settings: object,
) -> None:
    """An operator signed in by magic link alone is refused until they add a passkey."""
    enable_staff_auth(test_settings)
    magic_link_only = {
        "X-Atlas-Actor-Assertion": sign_app_assertion(
            user_id="user_editor", email=STAFF_EMAIL, account_ready=False
        )
    }

    response = await test_client.post("/api/review-queue/missing/approve", headers=magic_link_only)

    assert response.status_code == HTTPStatus.FORBIDDEN
