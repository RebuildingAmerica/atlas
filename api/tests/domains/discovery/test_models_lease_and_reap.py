"""Tests for discovery job claim, progress, and reaping behavior."""

from __future__ import annotations

import pytest

from atlas.domains.discovery.models import DiscoveryJobCRUD, DiscoveryRunCRUD
from atlas.models.database import get_db_connection

EXPECTED_DEAD_LETTER_RETRY_COUNT = 2


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
    async def test_claim_next_guarded_update_loses_race(
        self,
        db_url: str,
        sqlite_only: None,  # noqa: ARG002
    ) -> None:
        """If the candidate is claimed between SELECT and the guarded UPDATE, return None.

        Exercises SQLite's select-then-guarded-UPDATE claim path specifically:
        Postgres claims in one atomic ``UPDATE ... FOR UPDATE SKIP LOCKED``
        statement with no separate SELECT to interleave a racer against (see
        ``claim_next``'s docstring), so this scenario has no Postgres analogue.
        """
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
