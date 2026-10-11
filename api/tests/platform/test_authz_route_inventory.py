"""Every operator-only route declares the one action it performs, and nothing else does.

The inventory is taken under both deployment profiles: a managed deployment
adds the platform routes, and a self-hosted one has none of them, in its
routes or in its OpenAPI document.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas.main import create_app
from atlas.platform.authz import Action
from atlas.platform.http.platform_router import build_platform_openapi
from tests.support.route_inventory import route_declarations

if TYPE_CHECKING:
    import pytest
    from fastapi import FastAPI

PLATFORM_ROUTES: dict[tuple[str, str], Action] = {
    ("GET", "/api/platform/discount-verifications"): Action.DISCOUNTS_REVIEW,
    (
        "PATCH",
        "/api/platform/discount-verifications/{verification_id}",
    ): Action.DISCOUNTS_REVIEW,
    ("GET", "/api/platform/cloud-costs"): Action.COSTS_VIEW,
    ("GET", "/api/platform/switches"): Action.SWITCHES_READ,
    ("PUT", "/api/platform/switches/{name}"): Action.SWITCHES_WRITE,
    ("POST", "/api/platform/accounts/lookup"): Action.ACCOUNTS_READ,
    ("POST", "/api/platform/waitlist"): Action.WAITLIST_READ,
    ("POST", "/api/platform/waitlist/detail"): Action.WAITLIST_READ,
    ("POST", "/api/platform/waitlist/invite"): Action.WAITLIST_WRITE,
    ("POST", "/api/platform/waitlist/action"): Action.WAITLIST_WRITE,
}

INSTANCE_AND_MACHINE_ROUTES: dict[tuple[str, str], Action] = {
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
    ("GET", "/api/audit-log"): Action.AUDIT_READ,
    ("GET", "/api/takedowns"): Action.ENTRIES_TAKEDOWN,
    ("POST", "/api/takedowns"): Action.ENTRIES_TAKEDOWN,
    ("POST", "/api/takedowns/{takedown_id}/restore"): Action.ENTRIES_TAKEDOWN,
    ("GET", "/api/merges"): Action.ENTRIES_MERGE,
    ("GET", "/api/merges/preview"): Action.ENTRIES_MERGE,
    ("POST", "/api/merges"): Action.ENTRIES_MERGE,
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
    ("POST", "/api/discovery-runs/scheduled"): Action.TRIGGER_SCHEDULED_RUNS,
    (
        "POST",
        "/api/internal/firehose/observations/{observation_id}/signals",
    ): Action.DELIVER_FIREHOSE_OBSERVATIONS,
    ("POST", "/api/internal/firehose/observation-deliveries"): Action.DELIVER_FIREHOSE_OBSERVATIONS,
}


def _managed_app(monkeypatch: pytest.MonkeyPatch) -> FastAPI:
    monkeypatch.setenv("ATLAS_MANAGED", "true")
    return create_app()


def _declared(app: FastAPI) -> dict[tuple[str, str], set[Action]]:
    return {
        (declaration.method, declaration.path): set(declaration.actions)
        for declaration in route_declarations(app)
        if declaration.actions
    }


def _expected(routes: dict[tuple[str, str], Action]) -> dict[tuple[str, str], set[Action]]:
    return {route: {action} for route, action in routes.items()}


def test_a_managed_deployment_guards_exactly_the_expected_routes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    declared = _declared(_managed_app(monkeypatch))

    assert declared == _expected(INSTANCE_AND_MACHINE_ROUTES | PLATFORM_ROUTES)


def test_a_self_hosted_deployment_has_no_platform_routes() -> None:
    app = create_app()

    assert _declared(app) == _expected(INSTANCE_AND_MACHINE_ROUTES)
    assert not [path for path in app.openapi()["paths"] if path.startswith("/api/platform")]


def test_platform_routes_stay_out_of_the_public_openapi_even_when_managed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    public = _managed_app(monkeypatch).openapi()

    assert not [path for path in public["paths"] if path.startswith("/api/platform")]
    assert "platform" not in {
        tag for operation in _operations(public) for tag in operation.get("tags", [])
    }


def test_the_platform_document_describes_exactly_the_platform_routes() -> None:
    document = build_platform_openapi("test")

    described = {
        (method.upper(), path)
        for path, operations in document["paths"].items()
        for method in operations
    }
    assert described == set(PLATFORM_ROUTES)
    assert document["info"]["title"] == "Atlas platform API"


def test_every_action_except_the_visibility_check_guards_at_least_one_route(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guarded = {
        action for actions in _declared(_managed_app(monkeypatch)).values() for action in actions
    }

    assert set(Action) - guarded == {Action.RUNS_VIEW_ALL}


def _operations(document: dict[str, object]) -> list[dict[str, list[str]]]:
    paths = document["paths"]
    assert isinstance(paths, dict)
    return [operation for operations in paths.values() for operation in operations.values()]
