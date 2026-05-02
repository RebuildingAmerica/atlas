"""Tests for discovery model helpers and CRUD edge cases."""

from __future__ import annotations

import pytest

from atlas.domains.discovery.models import (
    DiscoveryJobCRUD,
    DiscoveryRunCRUD,
    DiscoveryRunModel,
    DiscoveryScheduleCRUD,
)


class TestDiscoveryRunToDict:
    def test_serializes_all_fields(self) -> None:
        model = DiscoveryRunModel(
            id="r1",
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
            queries_generated=10,
            sources_fetched=5,
            sources_processed=4,
            entries_extracted=3,
            entries_after_dedup=2,
            entries_confirmed=1,
            started_at="2026-04-30T00:00:00Z",
            completed_at=None,
            status="running",
            error_message=None,
            created_at="2026-04-30T00:00:00Z",
        )
        payload = model.to_dict()
        assert payload["id"] == "r1"
        assert payload["state"] == "TX"
        assert payload["issue_areas"] == ["housing_affordability"]
        assert payload["status"] == "running"


class TestDiscoveryRunCRUDUpdate:
    @pytest.mark.asyncio
    async def test_update_with_only_unknown_fields_returns_false(self, test_db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        result = await DiscoveryRunCRUD.update(test_db, run_id, totally_unknown_field="x")
        assert result is False


class TestDiscoveryScheduleCRUDUpdate:
    @pytest.mark.asyncio
    async def test_update_with_only_unknown_fields_returns_false(self, test_db: object) -> None:
        sid = await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        result = await DiscoveryScheduleCRUD.update(test_db, sid, totally_unknown_field="x")
        assert result is False


class TestDiscoveryJobCRUDGetByRunId:
    @pytest.mark.asyncio
    async def test_returns_none_when_no_jobs_for_run(self, test_db: object) -> None:
        result = await DiscoveryJobCRUD.get_by_run_id(test_db, "no-such-run-id")
        assert result is None
