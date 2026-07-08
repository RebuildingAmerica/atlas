"""Tests for discovery schedule management endpoints."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from atlas.domains.discovery import api_schedule
from atlas.domains.discovery.models import DiscoveryScheduleCRUD
from atlas.domains.discovery.schemas import (
    DiscoveryScheduleCreateRequest,
    DiscoveryScheduleUpdateRequest,
)
from tests.domains.discovery.schedule_support import EXPECTED_BAD_REQUEST, EXPECTED_NOT_FOUND


class TestScheduleEndpoints:
    @pytest.mark.asyncio
    async def test_create_schedule(self, test_db: object, actor) -> None:
        req = DiscoveryScheduleCreateRequest(
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        resp = await api_schedule.create_schedule(req, response=None, actor=actor, db=test_db)
        assert resp.id
        assert resp.location_query == "Austin, TX"
        assert resp.enabled is True

    @pytest.mark.asyncio
    async def test_list_schedules(self, test_db: object, actor) -> None:
        await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        resp = await api_schedule.list_schedules(
            response=None,
            enabled_only=False,
            limit=100,
            actor=actor,
            db=test_db,
        )
        assert resp.total == 1
        assert len(resp.items) == 1

    @pytest.mark.asyncio
    async def test_get_schedule(self, test_db: object, actor) -> None:
        sid = await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        resp = await api_schedule.get_schedule(sid, response=None, actor=actor, db=test_db)
        assert resp.id == sid

    @pytest.mark.asyncio
    async def test_get_schedule_not_found(self, test_db: object, actor) -> None:
        with pytest.raises(HTTPException) as exc_info:
            await api_schedule.get_schedule(
                "nonexistent",
                response=None,
                actor=actor,
                db=test_db,
            )
        assert exc_info.value.status_code == EXPECTED_NOT_FOUND

    @pytest.mark.asyncio
    async def test_update_schedule(self, test_db: object, actor) -> None:
        sid = await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        resp = await api_schedule.update_schedule(
            sid,
            DiscoveryScheduleUpdateRequest(enabled=False),
            response=None,
            actor=actor,
            db=test_db,
        )
        assert resp.enabled is False

    @pytest.mark.asyncio
    async def test_delete_schedule(self, test_db: object, actor) -> None:
        sid = await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        await api_schedule.delete_schedule(sid, actor=actor, db=test_db)
        assert await DiscoveryScheduleCRUD.get_by_id(test_db, sid) is None

    @pytest.mark.asyncio
    async def test_delete_schedule_not_found(self, test_db: object, actor) -> None:
        with pytest.raises(HTTPException) as exc_info:
            await api_schedule.delete_schedule("nonexistent", actor=actor, db=test_db)
        assert exc_info.value.status_code == EXPECTED_NOT_FOUND

    @pytest.mark.asyncio
    async def test_create_schedule_invalid_issue_area(self, test_db: object, actor) -> None:
        req = DiscoveryScheduleCreateRequest(
            location_query="Austin, TX",
            state="TX",
            issue_areas=["totally_fake_issue"],
        )
        with pytest.raises(HTTPException) as exc_info:
            await api_schedule.create_schedule(req, response=None, actor=actor, db=test_db)
        assert exc_info.value.status_code == EXPECTED_BAD_REQUEST

    @pytest.mark.asyncio
    async def test_update_schedule_not_found(self, test_db: object, actor) -> None:
        with pytest.raises(HTTPException) as exc_info:
            await api_schedule.update_schedule(
                "nonexistent",
                DiscoveryScheduleUpdateRequest(enabled=False),
                response=None,
                actor=actor,
                db=test_db,
            )
        assert exc_info.value.status_code == EXPECTED_NOT_FOUND

    @pytest.mark.asyncio
    async def test_update_schedule_invalid_issue_area(self, test_db: object, actor) -> None:
        sid = await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        with pytest.raises(HTTPException) as exc_info:
            await api_schedule.update_schedule(
                sid,
                DiscoveryScheduleUpdateRequest(issue_areas=["totally_fake_issue"]),
                response=None,
                actor=actor,
                db=test_db,
            )
        assert exc_info.value.status_code == EXPECTED_BAD_REQUEST

    @pytest.mark.asyncio
    async def test_update_schedule_with_empty_payload_returns_unchanged(
        self, test_db: object, actor
    ) -> None:
        sid = await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        resp = await api_schedule.update_schedule(
            sid,
            DiscoveryScheduleUpdateRequest(),
            response=None,
            actor=actor,
            db=test_db,
        )
        assert resp.id == sid
