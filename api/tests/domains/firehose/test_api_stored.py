"""Stored-signal Firehose API tests."""

from __future__ import annotations

from http import HTTPStatus

import pytest

from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.domains.firehose.models import (
    FirehoseArtifactCreate,
    FirehoseArtifactCRUD,
    FirehoseRouteCreate,
    FirehoseRouteCRUD,
    FirehoseSignalCreate,
    FirehoseSignalCRUD,
    FirehoseSourceTargetCreate,
    FirehoseSourceTargetCRUD,
)


async def _stored_signal(test_db: object) -> str:
    target = await CoverageTargetCRUD.create(
        test_db,
        org_id="local",
        name="Las Vegas housing watch",
        geography="Las Vegas, NV",
        issue_areas=["housing"],
        actor_types=["organization"],
        source_types=["rss"],
        gaps=[],
        next_actions=[],
        linked_discovery_run_ids=[],
        linked_entry_ids=[],
        created_by="local-operator",
    )
    source_target = await FirehoseSourceTargetCRUD.create(
        test_db,
        FirehoseSourceTargetCreate(
            org_id="local",
            coverage_target_id=target.id,
            label="Example Civic News",
            url="https://news.example/feed.xml",
            source_kind="rss",
            source_class="local_news",
            places=["las-vegas-nv"],
            issues=["housing"],
            created_by="local-operator",
        ),
    )
    artifact = await FirehoseArtifactCRUD.create(
        test_db,
        FirehoseArtifactCreate(
            source_target_id=source_target.id,
            org_id="local",
            coverage_target_id=target.id,
            source_url="https://news.example/housing-forum",
            canonical_url="https://news.example/housing-forum",
            title="Tenant coalition announces public forum",
            publisher="Example Civic News",
            source_kind="rss",
            source_class="local_news",
            published_at="2026-07-07T15:00:00Z",
            detected_at="2026-07-07T15:01:00Z",
            fetched_at="2026-07-07T15:01:03Z",
            content_hash="sha256:housing-forum",
            fingerprint="housing-forum",
            relevant_text="A tenant coalition announced a public forum on rental assistance.",
            raw_content=None,
            http_status=200,
            metadata={},
        ),
    )
    signal = await FirehoseSignalCRUD.create(
        test_db,
        FirehoseSignalCreate(
            artifact_id=artifact.id,
            org_id="local",
            coverage_target_id=target.id,
            signal_type="coalition_activity",
            title="Tenant coalition announces public forum",
            summary="A tenant coalition announced a public forum on rental assistance.",
            occurred_at="2026-07-09T01:00:00Z",
            detected_at="2026-07-07T15:01:00Z",
            public_realm_basis="Published public civic source",
            places=["las-vegas-nv"],
            issues=["housing"],
            actors=[],
            confidence=0.78,
            sensitivity=0.12,
            review_state="not_required",
            visibility="workspace",
            route_state="routed",
        ),
    )
    await FirehoseRouteCRUD.create(
        test_db,
        FirehoseRouteCreate(
            signal_id=signal.id,
            destination_type="workspace",
            destination_id=target.id,
            state="active",
            route_reason="Matches watched coverage target",
        ),
    )
    return signal.id


@pytest.mark.asyncio
async def test_firehose_snapshot_returns_stored_workspace_signals(
    test_client: object,
    test_db: object,
) -> None:
    """The top-level Firehose snapshot should serve stored workspace signals."""
    signal_id = await _stored_signal(test_db)

    response = await test_client.get(
        "/api/firehose",
        params={
            "issue": "housing",
            "place": "las-vegas-nv",
            "signal_type": "coalition_activity",
            "source_class": "local_news",
        },
        headers={"Accept": "application/json"},
    )

    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["summary"]["total_signals"] == 1
    assert body["summary"]["visible_signals"] == 1
    assert body["summary"]["latest_cursor"] == "2026-07-07T15:01:00Z"
    assert body["signals"][0]["id"] == signal_id
    assert body["signals"][0]["evidence"][0]["source_url"] == "https://news.example/housing-forum"
    assert body["signals"][0]["destinations"][0]["type"] == "workspace"


@pytest.mark.asyncio
async def test_firehose_sse_replays_stored_workspace_signals(
    test_client: object,
    test_db: object,
) -> None:
    """SSE clients should receive stored matching signals after the ready event."""
    signal_id = await _stored_signal(test_db)

    response = await test_client.get(
        "/api/firehose",
        params={"place": "las-vegas-nv"},
        headers={"Accept": "text/event-stream"},
    )

    assert response.status_code == HTTPStatus.OK
    assert "event: firehose.ready" in response.text
    assert "event: firehose.signal" in response.text
    assert signal_id in response.text
    assert "event: heartbeat" in response.text
