"""Tests for discovery model helpers and CRUD edge cases."""

from __future__ import annotations

import pytest

from atlas.domains.discovery.models import (
    DiscoveryJobCRUD,
    DiscoveryRunCRUD,
    DiscoveryRunModel,
    DiscoveryScheduleCRUD,
)
from atlas.models.database import get_db_connection


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
