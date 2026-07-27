"""Tests for discovery model helpers and CRUD edge cases."""

# ruff: noqa

from __future__ import annotations

from tests.support.schema_introspection import table_columns

import pytest

from atlas.domains.discovery import models as discovery_models
from atlas.domains.discovery.models import (
    DiscoveryJobCRUD,
    DiscoveryRunCRUD,
    DiscoveryRunModel,
    DiscoveryScheduleCRUD,
)
from atlas.models.database import get_db_connection

EXPECTED_DEAD_LETTER_RETRY_COUNT = 2
EXPECTED_CANCELLED_JOB_COUNT = 2


class TestDiscoveryJobsSchema:
    @pytest.mark.asyncio
    async def test_discovery_jobs_has_idempotency_and_next_attempt_columns(
        self, db_url: str
    ) -> None:
        """init_db must add idempotency_key and next_attempt_at to discovery_jobs."""
        conn = await get_db_connection(db_url)
        try:
            rows = await table_columns(conn, "discovery_jobs")
        finally:
            await conn.close()

        columns = rows
        assert columns >= {"idempotency_key", "next_attempt_at"}


class TestDiscoveryRunToDict:
    def test_serializes_all_fields(self) -> None:
        research_summary = {
            "brief": "Three source-backed housing leads in Austin.",
            "ranked_leads": [
                {
                    "entry_id": "entry-1",
                    "name": "Austin Housing Coalition",
                    "type": "organization",
                    "why_it_matters": "Named by two tenant sources.",
                    "source_count": 2,
                    "latest_source_date": "2026-04-29",
                }
            ],
            "key_sources": [],
            "gaps": [],
            "reasoning_signals": ["Two independent sources mention tenant organizing."],
        }
        model = DiscoveryRunModel(
            id="r1",
            location_query="Austin, TX",
            state="TX",
            research_goal="interview_leads",
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
            research_summary=research_summary,
        )
        payload = model.to_dict()
        assert payload["id"] == "r1"
        assert payload["state"] == "TX"
        assert payload["research_goal"] == "interview_leads"
        assert payload["issue_areas"] == ["housing_affordability"]
        assert payload["status"] == "running"
        assert payload["research_summary"] == research_summary


class TestDiscoveryRunCRUDUpdate:
    @pytest.mark.asyncio
    async def test_create_persists_research_goal(self, test_db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
            research_goal="partner_scan",
        )

        run = await DiscoveryRunCRUD.get_by_id(test_db, run_id)

        assert run is not None
        assert run.research_goal == "partner_scan"

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

    @pytest.mark.asyncio
    async def test_update_research_summary_round_trips_json(self, test_db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        research_summary = {
            "brief": "Two source-backed tenant leads in Austin.",
            "ranked_leads": [
                {
                    "entry_id": "entry-1",
                    "name": "Austin Tenants Council",
                    "type": "organization",
                    "why_it_matters": "Appears in a city memo and a neighborhood article.",
                    "source_count": 2,
                    "latest_source_date": "2026-04-29",
                }
            ],
            "key_sources": [
                {
                    "source_id": "source-1",
                    "title": "Council housing agenda",
                    "url": "https://example.test/agenda",
                    "publication": "City Council",
                    "published_date": "2026-04-29",
                    "why_it_matters": "Names the coalition and meeting date.",
                }
            ],
            "gaps": [{"label": "Neighborhood groups", "detail": "No east-side group source yet."}],
            "reasoning_signals": ["City source and local coverage point to the same lead."],
        }

        updated = await DiscoveryRunCRUD.update_research_summary(test_db, run_id, research_summary)
        run = await DiscoveryRunCRUD.get_by_id(test_db, run_id)

        assert updated is True
        assert run is not None
        assert run.research_summary == research_summary


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


class TestDiscoveryJobQueueAndPayloadHelpers:
    @pytest.mark.asyncio
    async def test_list_queue_returns_empty_list_when_no_jobs_exist(self, test_db: object) -> None:
        """The queue helper should return an empty collection when nothing is queued."""
        assert await DiscoveryJobCRUD.list_queue(test_db) == []

    def test_job_input_payload_handles_mapped_and_decoded_inputs(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Job payload decoding should accept dicts, decode dicts, and reject others."""
        assert discovery_models._job_input_payload({"input_payload": {"x": 1}}) == {"x": 1}  # noqa: SLF001

        monkeypatch.setattr(
            discovery_models.db,
            "decode_json",
            lambda _value: {"direct_urls": ["https://example.test/seed"]},
        )
        assert discovery_models._job_input_payload({"input_payload": "{}"}) == {  # noqa: SLF001
            "direct_urls": ["https://example.test/seed"]
        }

        monkeypatch.setattr(discovery_models.db, "decode_json", lambda _value: ["bad"])
        assert discovery_models._job_input_payload({"input_payload": "{}"}) == {}  # noqa: SLF001
        assert discovery_models._job_input_payload({}) == {}  # noqa: SLF001


class TestDiscoveryJobCRUDCreateIdempotency:
    @pytest.mark.asyncio
    async def test_create_persists_idempotency_key(self, test_db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(
            test_db, run_id=run_id, idempotency_key="sched:s1:2026-06-23"
        )
        job = await DiscoveryJobCRUD.get_by_id(test_db, job_id)
        assert job is not None
        assert job.idempotency_key == "sched:s1:2026-06-23"

    @pytest.mark.asyncio
    async def test_create_without_idempotency_key_leaves_it_null(self, test_db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        job = await DiscoveryJobCRUD.get_by_id(test_db, job_id)
        assert job is not None
        assert job.idempotency_key is None

    @pytest.mark.asyncio
    async def test_duplicate_idempotency_key_returns_existing_job(self, test_db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        first = await DiscoveryJobCRUD.create(
            test_db, run_id=run_id, idempotency_key="sched:s1:2026-06-23"
        )
        second = await DiscoveryJobCRUD.create(
            test_db, run_id=run_id, idempotency_key="sched:s1:2026-06-23"
        )
        assert second == first
        queued = await DiscoveryJobCRUD.list_by_status(test_db, "queued")
        assert len([job for job in queued if job.run_id == run_id]) == 1

    @pytest.mark.asyncio
    async def test_get_by_idempotency_key_returns_job(self, test_db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(
            test_db, run_id=run_id, idempotency_key="sched:s1:2026-06-23"
        )
        job = await DiscoveryJobCRUD.get_by_idempotency_key(test_db, "sched:s1:2026-06-23")
        assert job is not None
        assert job.id == job_id
        assert job.run_id == run_id

    @pytest.mark.asyncio
    async def test_get_by_idempotency_key_missing_returns_none(self, test_db: object) -> None:
        job = await DiscoveryJobCRUD.get_by_idempotency_key(test_db, "sched:none:2026-06-23")
        assert job is None
