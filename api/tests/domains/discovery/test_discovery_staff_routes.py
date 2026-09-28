"""Discovery operations that spend Atlas money or touch every workspace stay with staff."""

from __future__ import annotations

import pytest

from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.discovery.models import DiscoveryRunCRUD
from tests.support.staff_auth import enable_staff_auth

HTTP_OK = 200
HTTP_CREATED = 201
HTTP_FORBIDDEN = 403
HTTP_NOT_FOUND = 404

STAFF_ONLY_ROUTES = (
    ("GET", "/api/discovery-schedules", None, HTTP_OK),
    (
        "POST",
        "/api/discovery-schedules",
        {
            "location_query": "Las Vegas, NV",
            "state": "NV",
            "issue_areas": ["public_transit"],
            "search_depth": "standard",
        },
        HTTP_CREATED,
    ),
    ("GET", "/api/discovery-schedules/missing", None, HTTP_NOT_FOUND),
    ("PATCH", "/api/discovery-schedules/missing", {"enabled": False}, HTTP_NOT_FOUND),
    ("DELETE", "/api/discovery-schedules/missing", None, HTTP_NOT_FOUND),
    ("POST", "/api/discovery-runs/missing/cancel", None, HTTP_NOT_FOUND),
    ("GET", "/api/discovery-runs/jobs/missing", None, HTTP_NOT_FOUND),
    ("GET", "/api/discovery-runs/summary", None, HTTP_OK),
)


@pytest.mark.asyncio
@pytest.mark.parametrize("route", STAFF_ONLY_ROUTES)
async def test_only_staff_run_discovery_operations(
    test_client: object,
    test_settings: object,
    route: tuple[str, str, dict[str, object] | None, int],
) -> None:
    method, path, body, staff_status = route
    headers = enable_staff_auth(test_settings)

    customer = await test_client.request(method, path, json=body, headers=headers.ordinary)
    staff = await test_client.request(method, path, json=body, headers=headers.staff)

    assert customer.status_code == HTTP_FORBIDDEN, customer.text
    assert staff.status_code == staff_status, staff.text


@pytest.mark.asyncio
async def test_signed_in_accounts_keep_their_research_list(
    test_client: object,
    test_settings: object,
) -> None:
    headers = enable_staff_auth(test_settings)

    response = await test_client.get("/api/discovery-runs", headers=headers.ordinary)

    assert response.status_code == HTTP_OK, response.text


async def _private_run(db: object, *, org_id: str) -> str:
    run_id = await DiscoveryRunCRUD.create(
        db,
        location_query="Las Vegas, NV",
        state="NV",
        issue_areas=["housing_affordability"],
    )
    await OwnershipCRUD.create_ownership(
        db,
        resource_id=run_id,
        resource_type="discovery_run",
        org_id=org_id,
        visibility="private",
        created_by="user_owner",
    )
    return run_id


@pytest.mark.asyncio
async def test_private_research_runs_stay_inside_their_workspace(
    test_client: object,
    test_db: object,
    test_settings: object,
) -> None:
    headers = enable_staff_auth(test_settings)
    private_run = await _private_run(test_db, org_id="org_owner")
    shared_run = await DiscoveryRunCRUD.create(
        test_db,
        location_query="Reno, NV",
        state="NV",
        issue_areas=["public_transit"],
    )
    outsider = {**headers.ordinary, "X-Atlas-Organization-Id": "org_other"}
    member = {**headers.ordinary, "X-Atlas-Organization-Id": "org_owner"}

    for viewer, sees_private in (
        (outsider, False),
        (headers.ordinary, False),
        (member, True),
        (headers.staff, True),
    ):
        listed = await test_client.get("/api/discovery-runs", headers=viewer)
        assert listed.status_code == HTTP_OK, listed.text
        listed_ids = {item["id"] for item in listed.json()["items"]}
        assert shared_run in listed_ids
        assert (private_run in listed_ids) is sees_private
        assert listed.json()["total"] == (2 if sees_private else 1)

        detail = await test_client.get(f"/api/discovery-runs/{private_run}", headers=viewer)
        assert detail.status_code == (HTTP_OK if sees_private else HTTP_NOT_FOUND), detail.text
