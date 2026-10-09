"""The authorization policy decides what an authenticated caller may do, in one place."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from atlas.domains.access.principals import AuthenticatedActor
from atlas.platform.authz import Action, Decision, authorize, is_granted, require_action
from tests.support.authz_requests import guard_request

HTTP_FORBIDDEN = 403
HTTP_NOT_FOUND = 404
OPERATOR = "editor@rebuildingus.org"
EDITORIAL_REFUSAL = "Editorial review requires Atlas staff."
PLATFORM_REFUSAL = "This is done in the Atlas platform admin."
GENERIC_REFUSAL = "This action requires Atlas staff."

INSTANCE_ACTIONS = [action for action in Action if action.value.startswith("instance.")]
PLATFORM_ACTIONS = [action for action in Action if action.value.startswith("platform.")]
MACHINE_ACTIONS = [action for action in Action if action.value.startswith("machine.")]
MACHINE_REFUSAL = "Only a trusted machine credential can do this."


def _actor(
    *,
    auth_type: str = "internal",
    email: str = OPERATOR,
    account_ready: bool = True,
) -> AuthenticatedActor:
    return AuthenticatedActor(
        user_id="user_1",
        email=email,
        auth_type=auth_type,
        permissions={"discovery": ["read", "write"]},
        account_ready=account_ready,
    )


def _local_actor() -> AuthenticatedActor:
    return AuthenticatedActor(user_id="local", email="", auth_type="local", is_local=True)


def test_every_action_is_an_instance_platform_or_machine_operation() -> None:
    assert INSTANCE_ACTIONS
    assert PLATFORM_ACTIONS
    assert MACHINE_ACTIONS
    assert len(INSTANCE_ACTIONS) + len(PLATFORM_ACTIONS) + len(MACHINE_ACTIONS) == len(list(Action))


@pytest.mark.parametrize("action", MACHINE_ACTIONS)
def test_no_person_ever_holds_a_machine_action(test_settings: object, action: Action) -> None:
    test_settings.instance_operator_emails = [OPERATOR]
    test_settings.managed = True

    for actor in (_actor(), _local_actor()):
        decision = authorize(actor, action, test_settings)

        assert decision.allowed is False
        assert decision.status_code == HTTP_FORBIDDEN
        assert decision.detail == MACHINE_REFUSAL


@pytest.mark.parametrize("action", INSTANCE_ACTIONS)
def test_allowlisted_operator_may_perform_instance_actions(
    test_settings: object,
    action: Action,
) -> None:
    test_settings.instance_operator_emails = [f" {OPERATOR.upper()} ", ""]

    decision = authorize(_actor(email=f"{OPERATOR} "), action, test_settings)

    assert decision == Decision(allowed=True)


@pytest.mark.parametrize("auth_type", ["api_key", "oauth_jwt"])
@pytest.mark.parametrize("action", INSTANCE_ACTIONS)
def test_customer_credentials_never_perform_instance_actions(
    test_settings: object,
    action: Action,
    auth_type: str,
) -> None:
    test_settings.instance_operator_emails = [OPERATOR]

    decision = authorize(_actor(auth_type=auth_type), action, test_settings)

    assert decision.allowed is False
    assert decision.status_code == HTTP_FORBIDDEN


@pytest.mark.parametrize("action", INSTANCE_ACTIONS)
def test_signed_in_account_outside_the_allowlist_is_refused(
    test_settings: object,
    action: Action,
) -> None:
    test_settings.instance_operator_emails = [OPERATOR]

    decision = authorize(_actor(email="visitor@example.org"), action, test_settings)

    assert decision.allowed is False
    assert decision.status_code == HTTP_FORBIDDEN


@pytest.mark.parametrize("action", list(Action))
def test_operator_without_a_passkey_ready_session_is_refused(
    test_settings: object,
    action: Action,
) -> None:
    """A magic-link-only session proves a mailbox, not the operator, so it holds no authority."""
    test_settings.instance_operator_emails = [OPERATOR]
    test_settings.managed = True

    decision = authorize(_actor(account_ready=False), action, test_settings)

    assert decision.allowed is False
    assert decision.status_code == HTTP_FORBIDDEN


def test_empty_allowlist_refuses_every_signed_in_account(test_settings: object) -> None:
    test_settings.instance_operator_emails = []

    assert is_granted(_actor(), Action.REVIEW_QUEUE_DECIDE, test_settings) is False


@pytest.mark.parametrize("action", INSTANCE_ACTIONS)
def test_local_single_user_mode_may_perform_instance_actions(
    test_settings: object,
    action: Action,
) -> None:
    test_settings.instance_operator_emails = []

    assert is_granted(_local_actor(), action, test_settings) is True


@pytest.mark.parametrize(
    ("action", "detail"),
    [
        (Action.FLAGS_READ, EDITORIAL_REFUSAL),
        (Action.FLAGS_RESOLVE, EDITORIAL_REFUSAL),
        (Action.REVIEW_QUEUE_READ, EDITORIAL_REFUSAL),
        (Action.REVIEW_QUEUE_STAGE, EDITORIAL_REFUSAL),
        (Action.REVIEW_QUEUE_SCAN, EDITORIAL_REFUSAL),
        (Action.REVIEW_QUEUE_DECIDE, EDITORIAL_REFUSAL),
        (Action.CLAIMS_REVIEW, GENERIC_REFUSAL),
        (Action.SCHEDULES_READ, GENERIC_REFUSAL),
        (Action.SCHEDULES_WRITE, GENERIC_REFUSAL),
        (Action.RUNS_CANCEL, GENERIC_REFUSAL),
        (Action.RUNS_INSPECT, GENERIC_REFUSAL),
        (Action.RUNS_VIEW_ALL, GENERIC_REFUSAL),
        (Action.DISCOUNTS_REVIEW, PLATFORM_REFUSAL),
        (Action.COSTS_VIEW, PLATFORM_REFUSAL),
    ],
)
def test_refusals_keep_the_wording_each_surface_already_shows(
    test_settings: object,
    action: Action,
    detail: str,
) -> None:
    test_settings.instance_operator_emails = [OPERATOR]
    test_settings.managed = True

    decision = authorize(_actor(email="visitor@example.org"), action, test_settings)

    assert decision.detail == detail


@pytest.mark.parametrize("action", PLATFORM_ACTIONS)
def test_platform_actions_do_not_exist_when_the_deployment_is_not_managed(
    test_settings: object,
    action: Action,
) -> None:
    test_settings.instance_operator_emails = [OPERATOR]
    test_settings.managed = False

    for actor in (_actor(), _local_actor()):
        decision = authorize(actor, action, test_settings)

        assert decision.allowed is False
        assert decision.status_code == HTTP_NOT_FOUND
        assert decision.detail == "Not found."


@pytest.mark.parametrize("action", PLATFORM_ACTIONS)
def test_no_one_signed_in_to_the_atlas_app_holds_platform_actions(
    test_settings: object,
    action: Action,
) -> None:
    """Platform work happens in the platform admin, behind Cloudflare Access."""
    test_settings.instance_operator_emails = [OPERATOR]
    test_settings.managed = True

    decision = authorize(_actor(), action, test_settings)

    assert is_granted(_actor(), action, test_settings) is False
    assert decision.status_code == HTTP_FORBIDDEN
    assert decision.detail == PLATFORM_REFUSAL


@pytest.mark.parametrize("action", PLATFORM_ACTIONS)
def test_local_single_user_mode_never_holds_platform_actions(
    test_settings: object,
    action: Action,
) -> None:
    test_settings.instance_operator_emails = []
    test_settings.managed = True

    decision = authorize(_local_actor(), action, test_settings)

    assert decision.allowed is False
    assert decision.status_code == HTTP_FORBIDDEN


@pytest.mark.asyncio
async def test_require_action_returns_the_actor_when_allowed(test_settings: object) -> None:
    test_settings.instance_operator_emails = [OPERATOR]
    actor = _actor()

    dependency = require_action(Action.SCHEDULES_WRITE)

    assert await dependency(request=guard_request(), actor=actor, settings=test_settings) is actor


@pytest.mark.asyncio
async def test_require_action_raises_the_decision_when_refused(test_settings: object) -> None:
    test_settings.instance_operator_emails = [OPERATOR]

    dependency = require_action(Action.REVIEW_QUEUE_DECIDE)

    with pytest.raises(HTTPException) as exc:
        await dependency(
            request=guard_request(),
            actor=_actor(email="visitor@example.org"),
            settings=test_settings,
        )

    assert exc.value.status_code == HTTP_FORBIDDEN
    assert exc.value.detail == EDITORIAL_REFUSAL


@pytest.mark.asyncio
async def test_require_action_reports_a_missing_platform_surface_as_not_found(
    test_settings: object,
) -> None:
    test_settings.instance_operator_emails = [OPERATOR]
    test_settings.managed = False

    dependency = require_action(Action.DISCOUNTS_REVIEW)

    with pytest.raises(HTTPException) as exc:
        await dependency(request=guard_request(), actor=_actor(), settings=test_settings)

    assert exc.value.status_code == HTTP_NOT_FOUND


def test_require_action_records_which_action_it_guards() -> None:
    assert require_action(Action.CLAIMS_REVIEW).authz_action is Action.CLAIMS_REVIEW
