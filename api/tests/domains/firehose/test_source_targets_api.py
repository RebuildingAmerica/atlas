"""Firehose source-target API tests."""

from __future__ import annotations

from http import HTTPStatus

import pytest

from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD

RSS_BODY = """<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Toledo civic agenda</title>
    <item>
      <guid>bus-hearing</guid>
      <title>Bus hearing agenda</title>
      <link>https://toledo.example/agendas/bus-hearing</link>
      <description>The board posted a public hearing agenda for bus frequency changes.</description>
      <pubDate>Tue, 07 Jul 2026 16:20:00 GMT</pubDate>
    </item>
  </channel>
</rss>
"""


async def _coverage_target(test_db: object) -> str:
    target = await CoverageTargetCRUD.create(
        test_db,
        org_id="local",
        name="Toledo transit watch",
        geography="Toledo, OH",
        issue_areas=["transit"],
        actor_types=["organization"],
        source_types=["rss"],
        gaps=[],
        next_actions=[],
        linked_discovery_run_ids=[],
        linked_entry_ids=[],
        created_by="local-operator",
    )
    return target.id


@pytest.mark.asyncio
async def test_create_and_list_firehose_source_targets(
    test_client: object,
    test_db: object,
) -> None:
    """Operators should be able to register watched Firehose source targets."""
    coverage_target_id = await _coverage_target(test_db)

    create_response = await test_client.post(
        "/api/firehose/source-targets",
        json={
            "coverage_target_id": coverage_target_id,
            "label": "Toledo Civic Agenda",
            "url": "https://toledo.example/feed.xml",
            "source_kind": "rss",
            "source_class": "government_agenda",
            "places": ["toledo-oh"],
            "issues": ["transit"],
            "public_route_enabled": True,
        },
    )

    assert create_response.status_code == HTTPStatus.CREATED
    created = create_response.json()
    assert created["org_id"] == "local"
    assert created["coverage_target_id"] == coverage_target_id
    assert created["public_route_enabled"] is True

    list_response = await test_client.get(
        "/api/firehose/source-targets",
        params={"coverage_target_id": coverage_target_id},
    )

    assert list_response.status_code == HTTPStatus.OK
    body = list_response.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == created["id"]
    assert body["items"][0]["url"] == "https://toledo.example/feed.xml"


@pytest.mark.asyncio
async def test_run_firehose_source_target_once_creates_queryable_signal(
    test_client: object,
    test_db: object,
) -> None:
    """The source-target API should prove the stored source-to-signal loop."""
    coverage_target_id = await _coverage_target(test_db)
    create_response = await test_client.post(
        "/api/firehose/source-targets",
        json={
            "coverage_target_id": coverage_target_id,
            "label": "Toledo Civic Agenda",
            "url": "https://toledo.example/feed.xml",
            "source_kind": "rss",
            "source_class": "government_agenda",
            "places": ["toledo-oh"],
            "issues": ["transit"],
            "public_route_enabled": True,
        },
    )
    source_target_id = create_response.json()["id"]

    run_response = await test_client.post(
        f"/api/firehose/source-targets/{source_target_id}/runs",
        json={
            "body": RSS_BODY,
            "content_type": "application/rss+xml",
            "etag": '"rss-v1"',
            "fetched_at": "2026-07-07T16:21:00Z",
            "last_modified": None,
            "status_code": 200,
            "url": "https://toledo.example/feed.xml",
        },
    )

    assert run_response.status_code == HTTPStatus.CREATED
    assert run_response.json() == {
        "artifacts_created": 1,
        "routes_created": 2,
        "signals_created": 1,
        "unchanged": False,
    }

    firehose_response = await test_client.get(
        "/api/firehose",
        params={"place": "toledo-oh", "signal_type": "public_meeting"},
        headers={"Accept": "application/json"},
    )
    assert firehose_response.status_code == HTTPStatus.OK
    body = firehose_response.json()
    assert body["summary"]["total_signals"] == 1
    assert body["signals"][0]["title"] == "Bus hearing agenda"


@pytest.mark.asyncio
async def test_create_firehose_source_target_rejects_wrong_workspace_target(
    test_client: object,
    test_db: object,
) -> None:
    """A workspace cannot attach Firehose sources to another workspace's target."""
    target = await CoverageTargetCRUD.create(
        test_db,
        org_id="other-org",
        name="Other watch",
        geography="Austin, TX",
        issue_areas=["housing"],
        actor_types=["organization"],
        source_types=["rss"],
        gaps=[],
        next_actions=[],
        linked_discovery_run_ids=[],
        linked_entry_ids=[],
        created_by="local-operator",
    )

    response = await test_client.post(
        "/api/firehose/source-targets",
        json={
            "coverage_target_id": target.id,
            "label": "Other Feed",
            "url": "https://other.example/feed.xml",
            "source_kind": "rss",
            "source_class": "local_news",
            "places": ["austin-tx"],
            "issues": ["housing"],
        },
    )

    assert response.status_code == HTTPStatus.NOT_FOUND
