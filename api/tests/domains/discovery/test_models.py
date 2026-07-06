"""Tests for discovery model helpers and CRUD edge cases."""
# ruff: noqa

from __future__ import annotations

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
            cursor = await conn.execute("PRAGMA table_info(discovery_jobs)")
            rows = await cursor.fetchall()
        finally:
            await conn.close()

        columns = {row[1] for row in rows}
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


class TestDiscoveryJobCRUDFailBackoff:
    @pytest.mark.asyncio
    async def test_requeued_job_gets_future_next_attempt_at(self, db_url: str) -> None:
        from datetime import UTC, datetime

        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            requeued = await DiscoveryJobCRUD.fail(conn, job_id, "boom")
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert requeued is True
        assert job is not None
        assert job.status == "queued"
        assert job.next_attempt_at is not None
        assert datetime.fromisoformat(job.next_attempt_at) > datetime.now(UTC)

    @pytest.mark.asyncio
    async def test_requeued_job_is_not_claimed_before_backoff(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            await DiscoveryJobCRUD.fail(conn, job_id, "boom")
            claimed = await DiscoveryJobCRUD.claim_next(conn, claimed_by="w1")
        finally:
            await conn.close()

        assert claimed is None

    @pytest.mark.asyncio
    async def test_dead_lettered_job_has_no_next_attempt_at(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id, max_retries=0)
            requeued = await DiscoveryJobCRUD.fail(conn, job_id, "boom")
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert requeued is False
        assert job is not None
        assert job.status == "failed"
        assert job.next_attempt_at is None

    @pytest.mark.asyncio
    async def test_backoff_caps_at_five_minutes(self, db_url: str) -> None:
        from datetime import UTC, datetime, timedelta

        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id, max_retries=20)
            await conn.execute(
                "UPDATE discovery_jobs SET retry_count = 15 WHERE id = ?",
                (job_id,),
            )
            await conn.commit()
            before = datetime.now(UTC)
            await DiscoveryJobCRUD.fail(conn, job_id, "boom")
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert job is not None
        assert job.next_attempt_at is not None
        delay = datetime.fromisoformat(job.next_attempt_at) - before
        # Cap is 300s of exponential backoff plus up to 4s of deterministic jitter.
        assert delay <= timedelta(seconds=305)


class TestDiscoveryJobCRUDCancel:
    @pytest.mark.asyncio
    async def test_cancel_queued_job(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            cancelled = await DiscoveryJobCRUD.cancel(conn, job_id)
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert cancelled is True
        assert job is not None
        assert job.status == "cancelled"

    @pytest.mark.asyncio
    async def test_cancel_running_job(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            await conn.execute(
                "UPDATE discovery_jobs SET status = 'running' WHERE id = ?", (job_id,)
            )
            await conn.commit()
            cancelled = await DiscoveryJobCRUD.cancel(conn, job_id)
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert cancelled is True
        assert job is not None
        assert job.status == "cancelled"

    @pytest.mark.asyncio
    async def test_cancel_completed_job_is_noop(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            await DiscoveryJobCRUD.complete(conn, job_id)
            cancelled = await DiscoveryJobCRUD.cancel(conn, job_id)
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert cancelled is False
        assert job is not None
        assert job.status == "completed"

    @pytest.mark.asyncio
    async def test_cancel_unknown_job_returns_false(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            cancelled = await DiscoveryJobCRUD.cancel(conn, "no-such-job")
        finally:
            await conn.close()

        assert cancelled is False

    @pytest.mark.asyncio
    async def test_cancelled_job_is_not_claimed(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            await DiscoveryJobCRUD.cancel(conn, job_id)
            claimed = await DiscoveryJobCRUD.claim_next(conn, claimed_by="w1")
        finally:
            await conn.close()

        assert claimed is None

    @pytest.mark.asyncio
    async def test_cancel_run_jobs_cancels_active_jobs(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            queued_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            running_id = await DiscoveryJobCRUD.create(
                conn, run_id=run_id, idempotency_key="k-running"
            )
            done_id = await DiscoveryJobCRUD.create(conn, run_id=run_id, idempotency_key="k-done")
            await conn.execute(
                "UPDATE discovery_jobs SET status = 'running' WHERE id = ?", (running_id,)
            )
            await conn.commit()
            await DiscoveryJobCRUD.complete(conn, done_id)

            count = await DiscoveryJobCRUD.cancel_run_jobs(conn, run_id)
            queued = await DiscoveryJobCRUD.get_by_id(conn, queued_id)
            running = await DiscoveryJobCRUD.get_by_id(conn, running_id)
            done = await DiscoveryJobCRUD.get_by_id(conn, done_id)
        finally:
            await conn.close()

        assert count == EXPECTED_CANCELLED_JOB_COUNT
        assert queued is not None
        assert queued.status == "cancelled"
        assert running is not None
        assert running.status == "cancelled"
        assert done is not None
        assert done.status == "completed"

    @pytest.mark.asyncio
    async def test_complete_after_cancel_does_not_resurrect_job(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            await DiscoveryJobCRUD.cancel(conn, job_id)
            await DiscoveryJobCRUD.complete(conn, job_id)
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert job is not None
        assert job.status == "cancelled"

    @pytest.mark.asyncio
    async def test_fail_after_cancel_does_not_resurrect_job(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            await DiscoveryJobCRUD.cancel(conn, job_id)
            requeued = await DiscoveryJobCRUD.fail(conn, job_id, "boom")
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert requeued is False
        assert job is not None
        assert job.status == "cancelled"

    @pytest.mark.asyncio
    async def test_fail_dead_letter_after_cancel_does_not_resurrect_job(self, db_url: str) -> None:
        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id, max_retries=0)
            await DiscoveryJobCRUD.cancel(conn, job_id)
            requeued = await DiscoveryJobCRUD.fail(conn, job_id, "boom")
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert requeued is False
        assert job is not None
        assert job.status == "cancelled"


class TestDiscoveryJobCRUDClaimNext:
    @pytest.mark.asyncio
    async def test_claim_next_does_not_double_claim(self, db_url: str) -> None:
        conn_a = await get_db_connection(db_url)
        conn_b = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn_a, location_query="KC", state="MO", issue_areas=["x"]
            )
            await DiscoveryJobCRUD.create(conn_a, run_id=run_id)
            first = await DiscoveryJobCRUD.claim_next(conn_a, claimed_by="w1")
            second = await DiscoveryJobCRUD.claim_next(conn_b, claimed_by="w2")
        finally:
            await conn_a.close()
            await conn_b.close()

        assert first is not None
        assert second is None

    @pytest.mark.asyncio
    async def test_claim_next_skips_future_next_attempt_at(self, db_url: str) -> None:
        from datetime import UTC, datetime, timedelta

        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            future = (datetime.now(UTC) + timedelta(seconds=300)).isoformat()
            await conn.execute(
                "UPDATE discovery_jobs SET next_attempt_at = ? WHERE id = ?",
                (future, job_id),
            )
            await conn.commit()
            claimed = await DiscoveryJobCRUD.claim_next(conn, claimed_by="w1")
        finally:
            await conn.close()

        assert claimed is None

    @pytest.mark.asyncio
    async def test_claim_next_takes_job_with_past_next_attempt_at(self, db_url: str) -> None:
        from datetime import UTC, datetime, timedelta

        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            past = (datetime.now(UTC) - timedelta(seconds=300)).isoformat()
            await conn.execute(
                "UPDATE discovery_jobs SET next_attempt_at = ? WHERE id = ?",
                (past, job_id),
            )
            await conn.commit()
            claimed = await DiscoveryJobCRUD.claim_next(conn, claimed_by="w1")
        finally:
            await conn.close()

        assert claimed is not None
        assert claimed.id == job_id

    @pytest.mark.asyncio
    async def test_claim_next_guarded_update_loses_race(self, db_url: str) -> None:
        """If the candidate is claimed between SELECT and the guarded UPDATE, return None."""
        conn = await get_db_connection(db_url)
        racer = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)

            original_execute = conn.execute
            calls = {"n": 0}

            async def racing_execute(sql: str, params: object = ()) -> object:
                result = await original_execute(sql, params)
                # After the candidate SELECT (the first execute call), let a
                # competing worker claim the same row so the guarded UPDATE
                # finds it no longer claimable.
                if calls["n"] == 0 and sql.strip().upper().startswith("SELECT"):
                    calls["n"] += 1
                    await racer.execute(
                        "UPDATE discovery_jobs SET status = 'claimed', "
                        "claimed_by = 'other', claimed_until = ? WHERE id = ?",
                        ("2999-01-01T00:00:00+00:00", job_id),
                    )
                    await racer.commit()
                return result

            conn.execute = racing_execute  # type: ignore[method-assign]
            claimed = await DiscoveryJobCRUD.claim_next(conn, claimed_by="w1")
        finally:
            await conn.close()
            await racer.close()

        assert claimed is None


class TestDiscoveryJobCRUDUpdateProgressLease:
    @pytest.mark.asyncio
    async def test_update_progress_renews_lease(self, db_url: str) -> None:
        """Reporting progress must renew the lease so a long-running job is not reaped."""
        from datetime import UTC, datetime, timedelta

        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            await DiscoveryJobCRUD.update_progress(
                conn, job_id, {"step": "running"}, lease_seconds=600
            )
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert job is not None
        assert job.status == "running"
        assert job.claimed_until is not None
        lease = datetime.fromisoformat(job.claimed_until)
        assert lease > datetime.now(UTC) + timedelta(seconds=540)


class TestDiscoveryJobCRUDReapOrphans:
    @pytest.mark.asyncio
    async def test_reap_requeues_running_job_with_expired_lease(self, db_url: str) -> None:
        from datetime import UTC, datetime, timedelta

        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            past = (datetime.now(UTC) - timedelta(seconds=10)).isoformat()
            await conn.execute(
                "UPDATE discovery_jobs SET status = 'running', claimed_by = 'dead-worker', "
                "claimed_until = ? WHERE id = ?",
                (past, job_id),
            )
            await conn.commit()
            reaped = await DiscoveryJobCRUD.reap_orphans(conn)
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert reaped == 1
        assert job is not None
        assert job.status == "queued"
        assert job.claimed_by is None
        assert job.claimed_until is None
        assert job.retry_count == 1

    @pytest.mark.asyncio
    async def test_reap_dead_letters_job_past_max_retries(self, db_url: str) -> None:
        from datetime import UTC, datetime, timedelta

        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id, max_retries=1)
            past = (datetime.now(UTC) - timedelta(seconds=10)).isoformat()
            await conn.execute(
                "UPDATE discovery_jobs SET status = 'claimed', claimed_by = 'dead-worker', "
                "claimed_until = ?, retry_count = 1 WHERE id = ?",
                (past, job_id),
            )
            await conn.commit()
            reaped = await DiscoveryJobCRUD.reap_orphans(conn)
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert reaped == 1
        assert job is not None
        assert job.status == "failed"
        assert job.retry_count == EXPECTED_DEAD_LETTER_RETRY_COUNT

    @pytest.mark.asyncio
    async def test_reap_ignores_live_lease(self, db_url: str) -> None:
        from datetime import UTC, datetime, timedelta

        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            future = (datetime.now(UTC) + timedelta(seconds=300)).isoformat()
            await conn.execute(
                "UPDATE discovery_jobs SET status = 'running', claimed_by = 'live-worker', "
                "claimed_until = ? WHERE id = ?",
                (future, job_id),
            )
            await conn.commit()
            reaped = await DiscoveryJobCRUD.reap_orphans(conn)
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert reaped == 0
        assert job is not None
        assert job.status == "running"

    @pytest.mark.asyncio
    async def test_reap_with_explicit_now(self, db_url: str) -> None:
        """The reaper accepts an injected clock so callers can reap deterministically."""
        from datetime import UTC, datetime, timedelta

        conn = await get_db_connection(db_url)
        try:
            run_id = await DiscoveryRunCRUD.create(
                conn, location_query="KC", state="MO", issue_areas=["x"]
            )
            job_id = await DiscoveryJobCRUD.create(conn, run_id=run_id)
            lease = (datetime.now(UTC) + timedelta(seconds=60)).isoformat()
            await conn.execute(
                "UPDATE discovery_jobs SET status = 'running', claimed_until = ? WHERE id = ?",
                (lease, job_id),
            )
            await conn.commit()
            far_future = (datetime.now(UTC) + timedelta(seconds=600)).isoformat()
            reaped = await DiscoveryJobCRUD.reap_orphans(conn, now=far_future)
            job = await DiscoveryJobCRUD.get_by_id(conn, job_id)
        finally:
            await conn.close()

        assert reaped == 1
        assert job is not None
        assert job.status == "queued"


class TestDiscoveryCRUDBranchHelpers:
    @pytest.mark.asyncio
    async def test_run_list_returns_empty_when_no_rows(self, test_db: object) -> None:
        """Discovery run listing should fail closed on an empty table."""
        assert await DiscoveryRunCRUD.list(test_db) == []

    @pytest.mark.asyncio
    async def test_schedule_helpers_cover_missing_and_boolean_paths(self, test_db: object) -> None:
        """Schedule helpers should handle missing rows and explicit boolean updates."""
        assert await DiscoveryScheduleCRUD.get_by_id(test_db, "missing") is None

        schedule_id = await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        disabled_id = await DiscoveryScheduleCRUD.create(
            test_db,
            location_query="Dallas, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        await DiscoveryScheduleCRUD.update(test_db, disabled_id, enabled=False)

        all_schedules = await DiscoveryScheduleCRUD.list(test_db)
        enabled_schedules = await DiscoveryScheduleCRUD.list(test_db, enabled_only=True)
        assert {schedule.id for schedule in all_schedules} == {schedule_id, disabled_id}
        assert [schedule.id for schedule in enabled_schedules] == [schedule_id]

        assert await DiscoveryScheduleCRUD.update(
            test_db,
            schedule_id,
            issue_areas=["worker_cooperatives"],
            enabled=False,
        )
        schedule = await DiscoveryScheduleCRUD.get_by_id(test_db, schedule_id)
        assert schedule is not None
        assert schedule.issue_areas == ["worker_cooperatives"]
        assert schedule.enabled is False
        assert await DiscoveryScheduleCRUD.delete(test_db, schedule_id)
        assert await DiscoveryScheduleCRUD.delete(test_db, "missing") is False

    @pytest.mark.asyncio
    async def test_job_helpers_cover_missing_rows_and_queue_items(self, test_db: object) -> None:
        """Job helpers should cover missing lookups, direct-url claims, and queue rows."""
        assert await DiscoveryJobCRUD.get_by_id(test_db, "missing") is None
        assert await DiscoveryJobCRUD.get_by_run_id(test_db, "missing-run") is None
        assert await DiscoveryJobCRUD.list_by_status(test_db, "queued") == []
        assert await DiscoveryJobCRUD.fail(test_db, "missing-job", "boom") is False

        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(
            test_db,
            run_id=run_id,
            job_input=discovery_models.DiscoveryJobInput(
                execution_mode="direct_url",
                payload={"direct_urls": ["https://example.test/seed"]},
            ),
        )
        job = await DiscoveryJobCRUD.get_by_id(test_db, job_id)
        assert job is not None
        assert job.execution_mode == "direct_url"
        assert await DiscoveryJobCRUD.get_by_run_id(test_db, run_id) is not None

        claimed = await DiscoveryJobCRUD.claim_next(
            test_db,
            claimed_by="worker-1",
            search_key_configured=False,
        )
        assert claimed is not None
        assert claimed.id == job_id
        assert await DiscoveryJobCRUD.release_worker_leases(test_db, "worker-1") == 1
        released = await DiscoveryJobCRUD.get_by_id(test_db, job_id)
        assert released is not None
        assert released.status == "queued"

        queue = await DiscoveryJobCRUD.list_queue(test_db)
        assert queue and queue[0].id == job_id
        assert queue[0].input_payload == {"direct_urls": ["https://example.test/seed"]}

    @pytest.mark.asyncio
    async def test_claim_next_can_opt_into_search_key_restrictions(self, test_db: object) -> None:
        """Direct-url jobs should remain claimable even without search credentials."""
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        job_id = await DiscoveryJobCRUD.create(
            test_db,
            run_id=run_id,
            job_input=discovery_models.DiscoveryJobInput(
                execution_mode="direct_url",
                payload={"direct_urls": ["https://example.test/seed"]},
            ),
        )

        claimed = await DiscoveryJobCRUD.claim_next(
            test_db,
            claimed_by="worker-2",
            search_key_configured=False,
        )

        assert claimed is not None
        assert claimed.id == job_id


class TestDiscoveryJobCRUDCountByStatus:
    @pytest.mark.asyncio
    async def test_count_by_status_aggregates_all_statuses(self, test_db: object) -> None:
        run_id = await DiscoveryRunCRUD.create(
            test_db,
            location_query="Austin, TX",
            state="TX",
            issue_areas=["housing_affordability"],
        )
        queued_total = 55
        for _ in range(queued_total):
            await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        failed_id = await DiscoveryJobCRUD.create(test_db, run_id=run_id)
        await test_db.execute(  # type: ignore[attr-defined]
            "UPDATE discovery_jobs SET status = 'failed' WHERE id = ?", (failed_id,)
        )
        await test_db.commit()  # type: ignore[attr-defined]

        counts = await DiscoveryJobCRUD.count_by_status(test_db)

        assert counts["queued"] == queued_total
        assert counts["failed"] == 1

    @pytest.mark.asyncio
    async def test_count_by_status_is_empty_with_no_jobs(self, test_db: object) -> None:
        counts = await DiscoveryJobCRUD.count_by_status(test_db)
        assert counts == {}
