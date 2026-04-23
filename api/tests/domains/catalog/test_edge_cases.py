"""Edge-case tests for Atlas catalog API surfaces."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from atlas.domains.catalog.api import public as public_api
from atlas.domains.catalog.api import taxonomy as taxonomy_api
from atlas.domains.catalog.schemas.entry import EntityCreateRequest
from atlas.models import EntryCRUD


@pytest.mark.asyncio
async def test_public_place_db_dependency_closes_connections(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The place-first DB dependency should always close its connection."""
    events: list[str] = []

    class FakeConnection:
        async def close(self) -> None:
            events.append("closed")

    async def fake_get_db_connection(database_url: str, **_kwargs: object) -> FakeConnection:
        assert database_url == "sqlite:///catalog.db"
        return FakeConnection()

    monkeypatch.setattr(public_api, "get_db_connection", fake_get_db_connection)

    dependency = public_api.get_db(
        SimpleNamespace(database_url="sqlite:///catalog.db", database_backend="sqlite")
    )
    connection = await anext(dependency)
    assert isinstance(connection, FakeConnection)
    await dependency.aclose()
    assert events == ["closed"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("path", "status_code"),
    [
        ("/api/places/kansas-city-mo/entities", 400),
        ("/api/places/kansas-city-mo/sources", 400),
        ("/api/places/kansas-city-mo/issue-signals", 400),
        ("/api/places/kansas-city-mo/coverage", 400),
        ("/api/places/kansas-city-mo/profile", 404),
    ],
)
async def test_public_place_routes_translate_service_value_errors(
    monkeypatch: pytest.MonkeyPatch,
    test_client: object,
    path: str,
    status_code: int,
) -> None:
    """Place-first routes should map service ValueErrors into stable HTTP responses."""

    class FailingService:
        async def get_place_entities(self, *args: object, **kwargs: object) -> dict[str, object]:  # noqa: ARG002
            raise ValueError("bad place")  # noqa: TRY003

        async def get_place_sources(self, *args: object, **kwargs: object) -> dict[str, object]:  # noqa: ARG002
            raise ValueError("bad place")  # noqa: TRY003

        async def get_place_issue_signals(
            self,
            *args: object,  # noqa: ARG002
            **kwargs: object,  # noqa: ARG002
        ) -> dict[str, object]:
            raise ValueError("bad place")  # noqa: TRY003

        async def get_place_coverage(self, *args: object, **kwargs: object) -> dict[str, object]:  # noqa: ARG002
            raise ValueError("bad place")  # noqa: TRY003

        async def get_place_profile(self, *args: object, **kwargs: object) -> dict[str, object]:  # noqa: ARG002
            raise ValueError("missing profile")  # noqa: TRY003

    monkeypatch.setattr(public_api, "_get_service", lambda _settings: FailingService())

    response = await test_client.get(path)

    assert response.status_code == status_code


@pytest.mark.asyncio
async def test_taxonomy_helpers_cover_direct_calls_without_response_objects() -> None:
    """Direct taxonomy helpers should still paginate correctly without cacheable responses."""
    domains = await taxonomy_api.list_domains(limit=3, cursor=None, response=None)
    issue_areas = await taxonomy_api.list_issue_areas(
        query=None, limit=2, cursor=None, response=None
    )

    assert len(domains.items) == 3  # noqa: PLR2004
    assert domains.next_cursor is not None
    assert len(issue_areas.items) == 2  # noqa: PLR2004
    assert issue_areas.next_cursor is not None


@pytest.mark.asyncio
async def test_issue_area_route_covers_success_and_not_found(test_client: object) -> None:
    """Issue-area detail routes should return canonical issue metadata and 404s."""
    success = await test_client.get("/api/issue-areas/housing_affordability")
    missing = await test_client.get("/api/issue-areas/not-a-real-issue")

    assert success.status_code == 200  # noqa: PLR2004
    assert success.json()["slug"] == "housing_affordability"
    assert missing.status_code == 404  # noqa: PLR2004


@pytest.mark.asyncio
async def test_entity_routes_cover_validation_missing_and_failure_edges(
    monkeypatch: pytest.MonkeyPatch,
    test_client: object,
    test_db: object,
) -> None:
    """Entity routes should cover invalid filters and CRUD edge conditions."""
    invalid_list = await test_client.get("/api/entities?issue_area=not_a_real_issue")
    missing_sources = await test_client.get("/api/entities/missing-entity/sources")
    missing_update = await test_client.patch(
        "/api/entities/missing-entity", json={"name": "Updated"}
    )
    missing_delete = await test_client.delete("/api/entities/missing-entity")

    assert invalid_list.status_code == 400  # noqa: PLR2004
    assert missing_sources.status_code == 404  # noqa: PLR2004
    assert missing_update.status_code == 404  # noqa: PLR2004
    assert missing_delete.status_code == 404  # noqa: PLR2004

    entity_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="No-op Update Org",
        description="Entity used to cover no-op updates.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )

    noop_update = await test_client.patch(f"/api/entities/{entity_id}", json={})
    assert noop_update.status_code == 200  # noqa: PLR2004
    assert noop_update.json()["id"] == entity_id

    async def fake_create(_db: object, **kwargs: object) -> str:  # noqa: ARG001
        return "entity_failure"

    async def missing_entry(_db: object, _entity_id: str) -> None:
        return None

    monkeypatch.setattr("atlas.domains.catalog.api.entries.EntryCRUD.create", fake_create)
    monkeypatch.setattr("atlas.domains.catalog.api.entries.EntryCRUD.get_by_id", missing_entry)

    create_failure = await test_client.post(
        "/api/entities",
        json={
            "type": "organization",
            "name": "Failure Org",
            "description": "A valid description for the creation failure path.",
            "city": "Kansas City",
            "state": "MO",
            "geo_specificity": "local",
            "issue_areas": [],
        },
    )
    assert create_failure.status_code == 500  # noqa: PLR2004


@pytest.mark.asyncio
async def test_update_entity_returns_500_when_refetching_the_entity_fails(
    monkeypatch: pytest.MonkeyPatch,
    test_client: object,
    test_db: object,
) -> None:
    """Entity updates should surface a 500 when the refetch step loses the updated record."""
    entity_id = await EntryCRUD.create(
        test_db,
        entry_type="organization",
        name="Update Failure Org",
        description="Entity used to cover update failure behavior.",
        city="Kansas City",
        state="MO",
        geo_specificity="local",
    )

    async def missing_updated_entity(_db: object, _entry_id: str) -> tuple[None, list[object]]:
        return (None, [])

    monkeypatch.setattr(
        "atlas.domains.catalog.api.entries.EntryCRUD.get_with_sources", missing_updated_entity
    )

    response = await test_client.patch(
        f"/api/entities/{entity_id}",
        json={"name": "Updated Name"},
    )

    assert response.status_code == 500  # noqa: PLR2004


def test_entity_create_schema_requires_geo_specificity() -> None:
    """Entity write schemas should reject requests without normalized geography specificity."""
    with pytest.raises(ValueError, match="geo_specificity is required"):
        EntityCreateRequest(
            type="organization",
            name="Missing Geography",
            description="This payload is intentionally missing geographic specificity.",
            city="Kansas City",
            state="MO",
        )
