"""Public Firehose proof surface contract tests."""

from __future__ import annotations

from dataclasses import replace
from http import HTTPStatus

import pytest
from fastapi import FastAPI, status
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from atlas.domains.discovery.coverage_targets import CoverageTargetCRUD
from atlas.domains.firehose import public as public_firehose_module
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
from atlas.domains.firehose.public import router as public_firehose_router

PUBLIC_FIREHOSE_PROTOCOL = "atlas.firehose.public.v1"
PUBLIC_SOCKET_IDLE_TIMEOUT_SECONDS = 15
EXPECTED_IDLE_HEARTBEATS = 2


class FakePublicWebSocket:
    def __init__(self) -> None:
        self.headers = {"sec-websocket-protocol": PUBLIC_FIREHOSE_PROTOCOL}
        self.sent: list[dict[str, object]] = []
        self.accepted_subprotocol: str | None = None

    async def accept(self, *, subprotocol: str | None = None) -> None:
        self.accepted_subprotocol = subprotocol

    async def send_json(self, payload: dict[str, object]) -> None:
        self.sent.append(payload)

    async def receive_text(self) -> str:
        return "client-message"


class ClosingPublicWebSocket(FakePublicWebSocket):
    async def receive_text(self) -> str:
        raise WebSocketDisconnect


async def _stored_public_signal(test_db: object) -> str:
    """Create one stored public Firehose signal for public feed tests."""
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
    source_target = await FirehoseSourceTargetCRUD.create(
        test_db,
        FirehoseSourceTargetCreate(
            org_id="local",
            coverage_target_id=target.id,
            label="Toledo Civic Agenda",
            url="https://toledo.example/feed.xml",
            source_kind="rss",
            source_class="government_agenda",
            places=["toledo-oh"],
            issues=["transit"],
            created_by="local-operator",
            public_route_enabled=True,
        ),
    )
    artifact = await FirehoseArtifactCRUD.create(
        test_db,
        FirehoseArtifactCreate(
            source_target_id=source_target.id,
            org_id="local",
            coverage_target_id=target.id,
            source_url="https://toledo.example/agendas/bus-hearing",
            canonical_url="https://toledo.example/agendas/bus-hearing",
            title="Bus hearing agenda",
            publisher="Toledo Civic Agenda",
            source_kind="rss",
            source_class="government_agenda",
            published_at="2026-07-07T16:20:00+00:00",
            detected_at="2026-07-07T16:21:00+00:00",
            fetched_at="2026-07-07T16:21:04+00:00",
            content_hash="sha256:toledo-bus-hearing",
            fingerprint="toledo-bus-hearing",
            relevant_text="The board posted a public hearing agenda for bus frequency changes.",
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
            signal_type="public_meeting",
            title="Transit board posts bus hearing agenda",
            summary="Toledo transit officials posted a public hearing agenda for bus changes.",
            occurred_at="2026-07-09T00:30:00+00:00",
            detected_at="2026-07-07T16:21:00+00:00",
            public_realm_basis="Published public meeting agenda",
            places=["toledo-oh"],
            issues=["transit"],
            actors=[],
            confidence=0.84,
            sensitivity=0.11,
            review_state="not_required",
            visibility="public",
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
    await FirehoseRouteCRUD.create(
        test_db,
        FirehoseRouteCreate(
            signal_id=signal.id,
            destination_type="public",
            destination_id=None,
            state="active",
            route_reason="Public-safe civic source",
        ),
    )
    return signal.id


async def test_public_firehose_snapshot_reads_stored_public_signals(
    test_client: object,
    test_db: object,
) -> None:
    """The public proof feed should read stored public-routed signals."""
    signal_id = await _stored_public_signal(test_db)

    response = await test_client.get(
        "/api/firehose/public",
        params={"place": "toledo-oh", "source_class": "government_agenda"},
    )

    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert [signal["id"] for signal in body["signals"]] == [signal_id]
    assert body["signals"][0]["evidence"]["source_url"] == (
        "https://toledo.example/agendas/bus-hearing"
    )
    assert body["signals"][0]["evidence"]["source_class"] == "government_agenda"
    assert body["summary"]["latest_detected_at"] == "2026-07-07T16:21:00+00:00"


async def test_public_firehose_snapshot_filters_public_safe_signals(
    test_client: object,
    test_db: object,
) -> None:
    """The public Firehose snapshot should expose only public-safe feed items."""
    signal_id = await _stored_public_signal(test_db)

    response = await test_client.get(
        "/api/firehose/public",
        params={"place": "toledo-oh", "issue": "transit", "signal_type": "public_meeting"},
    )

    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["query"] == {
        "issue": ["transit"],
        "limit": 50,
        "place": ["toledo-oh"],
        "signal_type": ["public_meeting"],
        "source_class": [],
    }
    assert [signal["id"] for signal in body["signals"]] == [signal_id]
    assert body["signals"][0]["visibility"] == "public"
    assert body["signals"][0]["review_state"] == "not_required"
    assert response.headers["cache-control"] == "public, max-age=30, s-maxage=30"


async def test_public_firehose_adapter_rejects_signals_without_public_evidence(
    test_db: object,
) -> None:
    signal_id = await _stored_public_signal(test_db)
    signal = await FirehoseSignalCRUD.get_by_id(test_db, signal_id)
    assert signal is not None

    assert public_firehose_module._stored_public_signal(signal) is not None  # noqa: SLF001

    private_signal = replace(signal, destinations=[])
    assert public_firehose_module._stored_public_signal(private_signal) is None  # noqa: SLF001

    no_evidence_signal = replace(signal, evidence=[])
    assert public_firehose_module._stored_public_signal(no_evidence_signal) is None  # noqa: SLF001


async def test_public_firehose_events_stream_ready_signal_and_heartbeat(
    test_client: object,
    test_db: object,
) -> None:
    """Public SSE should replay public-safe Firehose events for simple clients."""
    signal_id = await _stored_public_signal(test_db)

    response = await test_client.get(
        "/api/firehose/public/events",
        params={"place": "toledo-oh"},
        headers={"Accept": "text/event-stream"},
    )

    assert response.status_code == HTTPStatus.OK
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: firehose.ready" in response.text
    assert "event: firehose.signal" in response.text
    assert signal_id in response.text
    assert "event: heartbeat" in response.text


@pytest.mark.asyncio
async def test_public_firehose_socket_uses_public_subprotocol(test_db: object) -> None:
    """The public WebSocket should prove a live stream without auth."""
    signal_id = await _stored_public_signal(test_db)
    websocket = ClosingPublicWebSocket()

    await public_firehose_module.public_firehose_socket(
        websocket,  # type: ignore[arg-type]
        place=["toledo-oh"],
        db=test_db,
    )

    assert websocket.accepted_subprotocol == PUBLIC_FIREHOSE_PROTOCOL
    assert websocket.sent[0]["type"] == "firehose.ready"
    assert websocket.sent[0]["query"]["place"] == ["toledo-oh"]  # type: ignore[index]
    assert websocket.sent[1]["type"] == "firehose.signal"
    assert websocket.sent[1]["signal"]["id"] == signal_id  # type: ignore[index]
    assert websocket.sent[2]["type"] == "heartbeat"


def test_public_firehose_socket_rejects_missing_public_subprotocol() -> None:
    """Public Firehose sockets should fail closed when the protocol is absent."""
    app = FastAPI()
    app.include_router(public_firehose_router, prefix="/api")

    with (
        TestClient(app) as client,
        pytest.raises(WebSocketDisconnect) as exc_info,
        client.websocket_connect("/api/firehose/public/socket?place=detroit-mi"),
    ):
        pass

    assert exc_info.value.code == status.WS_1008_POLICY_VIOLATION


@pytest.mark.asyncio
async def test_public_firehose_socket_sends_heartbeat_after_idle(
    monkeypatch: pytest.MonkeyPatch,
    test_db: object,
) -> None:
    """Idle public sockets should keep the proof stream alive with heartbeats."""
    websocket = FakePublicWebSocket()
    calls = 0

    async def fake_wait_for(awaitable: object, *, timeout: int) -> str:
        nonlocal calls
        assert timeout == PUBLIC_SOCKET_IDLE_TIMEOUT_SECONDS
        if hasattr(awaitable, "close"):
            awaitable.close()
        calls += 1
        if calls == 1:
            raise TimeoutError
        raise WebSocketDisconnect

    monkeypatch.setattr(public_firehose_module.asyncio, "wait_for", fake_wait_for)

    await public_firehose_module.public_firehose_socket(
        websocket,  # type: ignore[arg-type]
        db=test_db,
    )

    assert websocket.accepted_subprotocol == PUBLIC_FIREHOSE_PROTOCOL
    assert [payload["type"] for payload in websocket.sent].count(
        "heartbeat"
    ) == EXPECTED_IDLE_HEARTBEATS
