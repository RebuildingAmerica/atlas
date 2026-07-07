"""Public Firehose proof surface contract tests."""

from __future__ import annotations

from http import HTTPStatus

from fastapi import FastAPI
from fastapi.testclient import TestClient

from atlas.domains.firehose.public import router as public_firehose_router

PUBLIC_FIREHOSE_PROTOCOL = "atlas.firehose.public.v1"


async def test_public_firehose_snapshot_filters_public_safe_signals(test_client: object) -> None:
    """The public Firehose snapshot should expose only public-safe feed items."""
    response = await test_client.get(
        "/api/firehose/public",
        params={"place": "detroit-mi", "issue": "transit", "signal_type": "public_meeting"},
    )

    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["query"] == {
        "issue": ["transit"],
        "limit": 50,
        "place": ["detroit-mi"],
        "signal_type": ["public_meeting"],
        "source_class": [],
    }
    assert [signal["id"] for signal in body["signals"]] == ["fh_public_detroit_hearing_agenda"]
    assert body["signals"][0]["visibility"] == "public"
    assert body["signals"][0]["review_state"] == "not_required"
    assert response.headers["cache-control"] == "public, max-age=30, s-maxage=30"


async def test_public_firehose_events_stream_ready_signal_and_heartbeat(
    test_client: object,
) -> None:
    """Public SSE should replay public-safe Firehose events for simple clients."""
    response = await test_client.get(
        "/api/firehose/public/events",
        params={"place": "detroit-mi"},
        headers={"Accept": "text/event-stream"},
    )

    assert response.status_code == HTTPStatus.OK
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: firehose.ready" in response.text
    assert "event: firehose.signal" in response.text
    assert "fh_public_detroit_hearing_agenda" in response.text
    assert "event: heartbeat" in response.text


def test_public_firehose_socket_uses_public_subprotocol() -> None:
    """The public WebSocket should prove a live stream without auth."""
    app = FastAPI()
    app.include_router(public_firehose_router, prefix="/api")

    with (
        TestClient(app) as client,
        client.websocket_connect(
            "/api/firehose/public/socket?place=detroit-mi",
            subprotocols=[PUBLIC_FIREHOSE_PROTOCOL],
        ) as websocket,
    ):
        assert websocket.accepted_subprotocol == PUBLIC_FIREHOSE_PROTOCOL
        ready = websocket.receive_json()
        signal = websocket.receive_json()
        heartbeat = websocket.receive_json()

    assert ready["type"] == "firehose.ready"
    assert ready["query"]["place"] == ["detroit-mi"]
    assert signal["type"] == "firehose.signal"
    assert signal["signal"]["id"] == "fh_public_detroit_hearing_agenda"
    assert heartbeat["type"] == "heartbeat"
