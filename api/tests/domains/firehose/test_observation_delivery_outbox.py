"""Firehose observation delivery outbox tests."""

from __future__ import annotations

import pytest

from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.domains.firehose import delivery_worker
from atlas.domains.firehose.model_deliveries import add_seconds
from atlas.domains.firehose.models import (
    FirehoseObservationCreate,
    FirehoseObservationCRUD,
    FirehoseObservationDeliveryCRUD,
    FirehoseSignalCRUD,
    FirehoseSignalQuery,
)

SECOND_ATTEMPT = 2
FAILURE_MESSAGE = "materializer unavailable"


class _FakeCursor:
    """Minimal cursor for claim race coverage."""

    async def fetchall(self) -> list[tuple[str]]:
        return [("delivery_raced",)]


class _FakeUpdate:
    """Minimal update result for claim race coverage."""

    rowcount = 0


class _FakeClaimConnection:
    """Connection that loses the delivery between select and update."""

    def __init__(self) -> None:
        self.committed = False

    async def execute(self, sql: str, _params: object) -> _FakeCursor | _FakeUpdate:
        if "SELECT id" in sql:
            return _FakeCursor()
        return _FakeUpdate()

    async def commit(self) -> None:
        self.committed = True


async def _coverage_target(test_db: object, org_id: str = "org_firehose") -> str:
    target = await CoverageTargetCRUD.create(
        test_db,
        org_id=org_id,
        name="Las Vegas housing watch",
        geography="Las Vegas, NV",
        issue_areas=["housing"],
        actor_types=["organization"],
        source_types=["rss"],
        gaps=[],
        next_actions=[],
        linked_discovery_run_ids=[],
        linked_entry_ids=[],
        created_by="user_firehose",
    )
    return target.id


async def _observation(test_db: object) -> str:
    coverage_target_id = await _coverage_target(test_db)
    observation = await FirehoseObservationCRUD.create(
        test_db,
        FirehoseObservationCreate(
            producer="discovery_sync",
            observation_type="actor_discovered",
            subject_type="entry",
            subject_id="entry_123",
            org_id="org_firehose",
            coverage_target_id=coverage_target_id,
            places=["las-vegas-nv"],
            issues=["housing"],
            source_class="discovery_run",
            occurred_at="2026-07-07T15:00:00+00:00",
            observed_at="2026-07-07T15:01:00+00:00",
            dedupe_key="discovery-run-1:entry_123",
            public_realm_basis="Source-backed Scout discovery result",
            confidence=0.81,
            sensitivity=0.1,
            payload={
                "title": "New housing organization found",
                "summary": "Example Org was found working on tenant support.",
            },
            evidence=[
                {
                    "source_url": "https://example.org/about",
                    "title": "About Example Org",
                    "publisher": "Example Org",
                    "published_at": None,
                    "captured_at": "2026-07-07T15:01:00+00:00",
                    "passage": "Example Org works on tenant support.",
                    "locator": None,
                    "content_hash": "sha256:example-org",
                    "source_class": "org_website",
                }
            ],
        ),
    )
    return observation.id


@pytest.mark.asyncio
async def test_observation_create_enqueues_one_delivery(test_db: object) -> None:
    """Every stored observation should have one pending delivery to the signal worker."""
    observation_id = await _observation(test_db)
    first = await FirehoseObservationDeliveryCRUD.get_by_observation_id(
        test_db,
        observation_id=observation_id,
    )

    duplicate = await FirehoseObservationCRUD.create(
        test_db,
        FirehoseObservationCreate(
            producer="discovery_sync",
            observation_type="actor_discovered",
            subject_type="entry",
            subject_id="entry_123",
            org_id="org_firehose",
            coverage_target_id=None,
            places=[],
            issues=[],
            source_class="discovery_run",
            occurred_at=None,
            observed_at="2026-07-07T15:02:00+00:00",
            dedupe_key="discovery-run-1:entry_123",
            public_realm_basis="Source-backed Scout discovery result",
            confidence=0.81,
            sensitivity=0.1,
            payload={"title": "Duplicate"},
            evidence=[],
        ),
    )
    deliveries = await FirehoseObservationDeliveryCRUD.list_by_observation_id(
        test_db,
        observation_id=duplicate.id,
    )

    assert first is not None
    assert first.status == "pending"
    assert first.attempts == 0
    assert duplicate.id == observation_id
    assert [delivery.id for delivery in deliveries] == [first.id]


@pytest.mark.asyncio
async def test_claim_due_deliveries_uses_lease(test_db: object) -> None:
    """A worker claim should hide leased deliveries until the lease expires."""
    observation_id = await _observation(test_db)

    first_claim = await FirehoseObservationDeliveryCRUD.claim_due(
        test_db,
        worker_id="worker_a",
        now="2026-07-07T15:02:00+00:00",
        lease_seconds=30,
        limit=5,
    )
    second_claim = await FirehoseObservationDeliveryCRUD.claim_due(
        test_db,
        worker_id="worker_b",
        now="2026-07-07T15:02:10+00:00",
        lease_seconds=30,
        limit=5,
    )
    expired_claim = await FirehoseObservationDeliveryCRUD.claim_due(
        test_db,
        worker_id="worker_b",
        now="2026-07-07T15:03:00+00:00",
        lease_seconds=30,
        limit=5,
    )

    assert [delivery.observation_id for delivery in first_claim] == [observation_id]
    assert first_claim[0].status == "claimed"
    assert first_claim[0].claimed_by == "worker_a"
    assert first_claim[0].attempts == 1
    assert second_claim == []
    assert [delivery.id for delivery in expired_claim] == [first_claim[0].id]
    assert expired_claim[0].claimed_by == "worker_b"
    assert expired_claim[0].attempts == SECOND_ATTEMPT


@pytest.mark.asyncio
async def test_claim_due_skips_delivery_lost_before_update() -> None:
    """Leased delivery claims should tolerate another worker winning the race."""
    conn = _FakeClaimConnection()

    claimed = await FirehoseObservationDeliveryCRUD.claim_due(
        conn,  # type: ignore[arg-type]
        worker_id="worker_a",
        now="2026-07-07T15:02:00",
        lease_seconds=30,
        limit=5,
    )

    assert claimed == []
    assert conn.committed is True


def test_add_seconds_accepts_naive_iso_timestamps() -> None:
    """Retry calculations should handle DB timestamps without explicit timezone text."""
    assert add_seconds("2026-07-07T15:02:00", 30) == "2026-07-07T15:02:30+00:00"


@pytest.mark.asyncio
async def test_worker_processes_due_delivery_once(test_db: object) -> None:
    """The outbox worker should materialize signals and mark the delivery delivered."""
    observation_id = await _observation(test_db)

    first = await delivery_worker.process_due_observation_deliveries(
        test_db,
        worker_id="worker_a",
        now="2026-07-07T15:02:00+00:00",
        lease_seconds=30,
        limit=5,
    )
    second = await delivery_worker.process_due_observation_deliveries(
        test_db,
        worker_id="worker_a",
        now="2026-07-07T15:03:00+00:00",
        lease_seconds=30,
        limit=5,
    )
    delivery = await FirehoseObservationDeliveryCRUD.get_by_observation_id(
        test_db,
        observation_id=observation_id,
    )
    signals = await FirehoseSignalCRUD.list_for_query(
        test_db,
        FirehoseSignalQuery(
            org_id="org_firehose",
            places=["las-vegas-nv"],
            issues=["housing"],
            signal_types=["actor_discovered"],
            source_classes=["org_website"],
            visibility="workspace",
            limit=10,
        ),
    )

    assert first.processed == 1
    assert first.delivered == 1
    assert first.failed == 0
    assert second.processed == 0
    assert delivery is not None
    assert delivery.status == "delivered"
    assert delivery.delivered_at is not None
    assert len(signals) == 1


@pytest.mark.asyncio
async def test_worker_records_retryable_failure(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failed delivery should keep retry state instead of losing the observation."""
    observation_id = await _observation(test_db)

    async def fail_materialization(*_args: object, **_kwargs: object) -> object:
        raise RuntimeError(FAILURE_MESSAGE)

    monkeypatch.setattr(
        delivery_worker,
        "create_signals_for_observation",
        fail_materialization,
    )

    result = await delivery_worker.process_due_observation_deliveries(
        test_db,
        worker_id="worker_a",
        now="2026-07-07T15:02:00+00:00",
        lease_seconds=30,
        limit=5,
    )
    delivery = await FirehoseObservationDeliveryCRUD.get_by_observation_id(
        test_db,
        observation_id=observation_id,
    )

    assert result.processed == 1
    assert result.delivered == 0
    assert result.failed == 1
    assert delivery is not None
    assert delivery.status == "failed"
    assert delivery.attempts == 1
    assert delivery.last_error == FAILURE_MESSAGE
    assert delivery.next_attempt_at > "2026-07-07T15:02:00+00:00"
