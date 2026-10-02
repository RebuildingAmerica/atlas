"""Every operator-only route declares the one action it performs, and nothing else does."""

from __future__ import annotations

from atlas.main import create_app
from atlas.platform.authz import Action
from tests.support.route_inventory import route_declarations

EXPECTED_ACTIONS: dict[tuple[str, str], Action] = {
    ("GET", "/api/correction-inbox"): Action.FLAGS_READ,
    ("GET", "/api/entity-flags"): Action.FLAGS_READ,
    ("GET", "/api/entity-flags/inbox"): Action.FLAGS_READ,
    ("GET", "/api/source-flags"): Action.FLAGS_READ,
    ("POST", "/api/entity-flags/{flag_id}/dismiss"): Action.FLAGS_RESOLVE,
    ("POST", "/api/entity-flags/{flag_id}/resolve"): Action.FLAGS_RESOLVE,
    ("POST", "/api/source-flags/{flag_id}/dismiss"): Action.FLAGS_RESOLVE,
    ("POST", "/api/source-flags/{flag_id}/resolve"): Action.FLAGS_RESOLVE,
    ("GET", "/api/review-queue"): Action.REVIEW_QUEUE_READ,
    ("POST", "/api/review-queue/editorial-candidates"): Action.REVIEW_QUEUE_STAGE,
    (
        "POST",
        "/api/review-queue/editorial-profiles/{entity_id}/changes",
    ): Action.REVIEW_QUEUE_STAGE,
    ("POST", "/api/review-queue/source-staleness-scan"): Action.REVIEW_QUEUE_SCAN,
    ("POST", "/api/review-queue/website-candidate-scan"): Action.REVIEW_QUEUE_SCAN,
    ("POST", "/api/review-queue/{item_id}/approve"): Action.REVIEW_QUEUE_DECIDE,
    ("POST", "/api/review-queue/{item_id}/reject"): Action.REVIEW_QUEUE_DECIDE,
    ("GET", "/api/profiles/claims/review"): Action.CLAIMS_REVIEW,
    ("POST", "/api/profiles/claims/review/atproto/revalidate"): Action.CLAIMS_REVIEW,
    ("POST", "/api/profiles/claims/review/{claim_id}/approve"): Action.CLAIMS_REVIEW,
    ("POST", "/api/profiles/claims/review/{claim_id}/reject"): Action.CLAIMS_REVIEW,
    ("GET", "/api/discovery-schedules"): Action.SCHEDULES_READ,
    ("GET", "/api/discovery-schedules/{schedule_id}"): Action.SCHEDULES_READ,
    ("POST", "/api/discovery-schedules"): Action.SCHEDULES_WRITE,
    ("PATCH", "/api/discovery-schedules/{schedule_id}"): Action.SCHEDULES_WRITE,
    ("DELETE", "/api/discovery-schedules/{schedule_id}"): Action.SCHEDULES_WRITE,
    ("POST", "/api/discovery-runs/{run_id}/cancel"): Action.RUNS_CANCEL,
    ("GET", "/api/discovery-runs/summary"): Action.RUNS_INSPECT,
    ("GET", "/api/admin/verifications"): Action.DISCOUNTS_REVIEW,
    ("PATCH", "/api/admin/verifications/{verification_id}"): Action.DISCOUNTS_REVIEW,
    ("GET", "/api/admin/cloud-costs"): Action.COSTS_VIEW,
}


def _declared() -> dict[tuple[str, str], set[Action]]:
    return {
        (declaration.method, declaration.path): set(declaration.actions)
        for declaration in route_declarations(create_app())
        if declaration.actions
    }


def test_operator_routes_declare_exactly_the_expected_action() -> None:
    declared = _declared()

    assert declared == {route: {action} for route, action in EXPECTED_ACTIONS.items()}


def test_every_action_except_the_visibility_check_guards_at_least_one_route() -> None:
    guarded = {action for actions in _declared().values() for action in actions}

    assert set(Action) - guarded == {Action.RUNS_VIEW_ALL}
