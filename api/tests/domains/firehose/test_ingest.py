"""Firehose source ingestion tests."""

from __future__ import annotations

import pytest

from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.domains.firehose.ingest import FirehoseFetchResult, run_source_target_once
from atlas.domains.firehose.models import (
    FirehoseObservationCRUD,
    FirehoseSignalCRUD,
    FirehoseSignalQuery,
    FirehoseSourceTargetCreate,
    FirehoseSourceTargetCRUD,
)

RSS_BODY = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Civic News</title>
    <item>
      <guid>housing-forum</guid>
      <title>Tenant coalition announces public forum</title>
      <link>https://news.example/housing-forum</link>
      <pubDate>Tue, 07 Jul 2026 15:00:00 GMT</pubDate>
      <description>A tenant coalition announced a public forum on rental assistance.</description>
    </item>
  </channel>
</rss>
"""
EXPECTED_PUBLIC_ROUTE_COUNT = 2


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


@pytest.mark.asyncio
async def test_run_source_target_once_stores_public_rss_signal(test_db: object) -> None:
    """A checked RSS source should create a stored artifact, signal, and public route."""
    coverage_target_id = await _coverage_target(test_db)
    target = await FirehoseSourceTargetCRUD.create(
        test_db,
        FirehoseSourceTargetCreate(
            org_id="org_firehose",
            coverage_target_id=coverage_target_id,
            label="Example Civic News",
            url="https://news.example/feed.xml",
            source_kind="rss",
            source_class="local_news",
            places=["las-vegas-nv"],
            issues=["housing"],
            created_by="user_firehose",
            public_route_enabled=True,
        ),
    )

    result = await run_source_target_once(
        test_db,
        target_id=target.id,
        fetched=FirehoseFetchResult(
            body=RSS_BODY,
            content_type="application/rss+xml",
            etag='"rss-v1"',
            fetched_at="2026-07-07T15:01:03Z",
            last_modified=None,
            status_code=200,
            url="https://news.example/feed.xml",
        ),
    )

    assert result.artifacts_created == 1
    assert result.signals_created == 1
    assert result.routes_created == EXPECTED_PUBLIC_ROUTE_COUNT
    assert result.unchanged is False

    signals = await FirehoseSignalCRUD.list_for_query(
        test_db,
        FirehoseSignalQuery(
            org_id="org_firehose",
            places=["las-vegas-nv"],
            issues=["housing"],
            signal_types=["coalition_activity"],
            visibility="workspace",
            limit=10,
        ),
    )

    assert len(signals) == 1
    assert signals[0].title == "Tenant coalition announces public forum"
    assert signals[0].primary_observation_id is not None
    assert signals[0].public_realm_basis == "Published public civic source"
    assert {destination.type for destination in signals[0].destinations} == {"workspace", "public"}

    observation = await FirehoseObservationCRUD.get_by_id(
        test_db,
        signals[0].primary_observation_id,
    )
    assert observation is not None
    assert observation.producer == "source_target"
    assert observation.observation_type == "watched_source_artifact"
    assert observation.subject_id == target.id


@pytest.mark.asyncio
async def test_run_source_target_once_skips_duplicate_feed_items(test_db: object) -> None:
    """A repeated source check should update source state without duplicate signals."""
    coverage_target_id = await _coverage_target(test_db)
    target = await FirehoseSourceTargetCRUD.create(
        test_db,
        FirehoseSourceTargetCreate(
            org_id="org_firehose",
            coverage_target_id=coverage_target_id,
            label="Example Civic News",
            url="https://news.example/feed.xml",
            source_kind="rss",
            source_class="local_news",
            places=["las-vegas-nv"],
            issues=["housing"],
            created_by="user_firehose",
        ),
    )
    fetched = FirehoseFetchResult(
        body=RSS_BODY,
        content_type="application/rss+xml",
        etag='"rss-v1"',
        fetched_at="2026-07-07T15:01:03Z",
        last_modified=None,
        status_code=200,
        url="https://news.example/feed.xml",
    )

    first = await run_source_target_once(test_db, target_id=target.id, fetched=fetched)
    second = await run_source_target_once(test_db, target_id=target.id, fetched=fetched)

    assert first.signals_created == 1
    assert second.artifacts_created == 0
    assert second.signals_created == 0
    assert second.routes_created == 0
    assert second.unchanged is True
