"""Firehose signal routing tests."""

from __future__ import annotations

import json

import pytest

from atlas.domains.access.models.watches import OrgWatchCRUD, OrgWatchUpsert
from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.domains.firehose.models import FirehoseObservationCreate, FirehoseObservationCRUD
from atlas.domains.firehose.signal_materializer import (
    _route_watch_digest_event,
    create_signals_for_observation,
)


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


async def _watched_coverage_observation(
    test_db: object,
    *,
    payload: dict[str, object] | None = None,
    sensitivity: float = 0.1,
    watch: bool = True,
) -> str:
    coverage_target_id = await _coverage_target(test_db)
    if watch:
        await OrgWatchCRUD.upsert(
            test_db,
            OrgWatchUpsert(
                org_id="org_firehose",
                resource_type="coverage_target",
                resource_id=coverage_target_id,
                created_by="user_firehose",
            ),
        )
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
            dedupe_key=f"discovery-run-1:entry_123:{sensitivity}:{payload}",
            public_realm_basis="Source-backed Scout discovery result",
            confidence=0.81,
            sensitivity=sensitivity,
            payload={
                "title": "New housing organization found",
                "summary": "Example Org was found working on tenant support.",
                **(payload or {}),
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


async def _civic_signal_events(test_db: object) -> list[dict[str, object]]:
    cursor = await test_db.execute(
        """
        SELECT event_type, title, summary, coverage_target_id, metadata_json
        FROM org_change_events
        WHERE event_type = 'civic_signal'
        ORDER BY created_at ASC, id ASC
        """
    )
    rows = await cursor.fetchall()
    return [
        {
            "event_type": row[0],
            "title": row[1],
            "summary": row[2],
            "coverage_target_id": row[3],
            "metadata": json.loads(row[4]),
        }
        for row in rows
    ]


@pytest.mark.asyncio
async def test_workspace_signal_routes_to_watch_digest_once(test_db: object) -> None:
    """A watched low-risk Firehose signal should appear in workspace digest once."""
    observation_id = await _watched_coverage_observation(test_db)

    first = await create_signals_for_observation(test_db, observation_id=observation_id)
    second = await create_signals_for_observation(test_db, observation_id=observation_id)
    events = await _civic_signal_events(test_db)
    observation = await FirehoseObservationCRUD.get_by_id(test_db, observation_id)
    assert observation is not None
    duplicate_digest = await _route_watch_digest_event(
        test_db,
        observation=observation,
        signal_id=str(events[0]["metadata"]["firehose_signal_id"]),
        signal_type=str(events[0]["metadata"]["firehose_signal_type"]),
        title="New housing organization found",
        summary="Example Org was found working on tenant support.",
        review_state="not_required",
        visibility="workspace",
    )

    assert first.signals_created == 1
    assert second.unchanged is True
    assert duplicate_digest is False
    assert len(events) == 1
    assert events[0]["event_type"] == "civic_signal"
    assert events[0]["title"] == "New housing organization found"
    assert events[0]["metadata"]["firehose_observation_id"] == observation_id
    assert events[0]["metadata"]["firehose_signal_id"]


@pytest.mark.asyncio
async def test_unwatched_signal_does_not_route_to_watch_digest(test_db: object) -> None:
    """Coverage-target signals should only reach digests when the workspace watches them."""
    observation_id = await _watched_coverage_observation(test_db, watch=False)

    await create_signals_for_observation(test_db, observation_id=observation_id)

    assert await _civic_signal_events(test_db) == []


@pytest.mark.asyncio
async def test_watch_digest_scan_skips_nonmatching_signal_metadata(test_db: object) -> None:
    """Existing digest events for other signals should not block a new civic signal."""
    observation_id = await _watched_coverage_observation(test_db)
    await create_signals_for_observation(test_db, observation_id=observation_id)
    observation = await FirehoseObservationCRUD.get_by_id(test_db, observation_id)
    assert observation is not None

    routed = await _route_watch_digest_event(
        test_db,
        observation=observation,
        signal_id="manual_second_signal",
        signal_type="actor_discovered",
        title="Second housing organization found",
        summary="A second source-backed organization was found.",
        review_state="not_required",
        visibility="workspace",
    )
    events = await _civic_signal_events(test_db)

    assert routed is True
    assert [event["metadata"]["firehose_signal_id"] for event in events] == [
        events[0]["metadata"]["firehose_signal_id"],
        "manual_second_signal",
    ]


@pytest.mark.asyncio
async def test_held_or_sensitive_signal_does_not_route_to_watch_digest(test_db: object) -> None:
    """Reviewer-held or sensitive Firehose signals should stay out of digest events."""
    held_observation_id = await _watched_coverage_observation(
        test_db,
        payload={"review_state": "held", "visibility": "reviewer"},
    )
    sensitive_observation_id = await _watched_coverage_observation(
        test_db,
        payload={"title": "Sensitive housing organization found"},
        sensitivity=0.8,
    )

    await create_signals_for_observation(test_db, observation_id=held_observation_id)
    await create_signals_for_observation(test_db, observation_id=sensitive_observation_id)

    assert await _civic_signal_events(test_db) == []
