"""Tests for the generated Firehose AsyncAPI contract."""

from __future__ import annotations

import json
from pathlib import Path

from atlas.domains.firehose.asyncapi import (
    build_firehose_asyncapi,
    export_firehose_asyncapi,
)
from atlas.domains.firehose.http import FIREHOSE_WEBSOCKET_PROTOCOL

PROJECT_ROOT = Path(__file__).resolve().parents[4]
ASYNCAPI_ARTIFACT = PROJECT_ROOT / "asyncapi" / "firehose.asyncapi.json"


def test_firehose_asyncapi_documents_streaming_protocol() -> None:
    """Firehose must publish a message contract for streams and sockets."""
    spec = build_firehose_asyncapi()

    assert spec["asyncapi"] == "3.0.0"
    assert spec["defaultContentType"] == "application/json"
    assert spec["x-atlas"]["websocketSubprotocol"] == FIREHOSE_WEBSOCKET_PROTOCOL

    channels = spec["channels"]
    assert channels["firehoseQueryEvents"]["address"] == "/api/firehose"
    assert channels["firehoseSessionEvents"]["address"] == (
        "/api/firehose/sessions/{session_id}/events"
    )
    assert channels["firehoseSessionSocket"]["address"] == (
        "/api/firehose/sessions/{session_id}/socket"
    )

    messages = spec["components"]["messages"]
    assert messages["FirehoseReady"]["payload"]["$ref"] == (
        "#/components/schemas/FirehoseReadyEvent"
    )
    assert messages["FirehoseHeartbeat"]["payload"]["$ref"] == (
        "#/components/schemas/FirehoseHeartbeatEvent"
    )
    assert messages["FirehoseSignalReceived"]["payload"]["$ref"] == (
        "#/components/schemas/FirehoseSignalEvent"
    )
    assert "FirehoseSignal" in spec["components"]["schemas"]
    assert "FirehoseSignalEvent" in spec["components"]["schemas"]

    receive_operation = spec["operations"]["receiveTopLevelFirehoseEvents"]
    operation_messages = {message["$ref"] for message in receive_operation["messages"]}
    assert "#/components/messages/FirehoseSignalReceived" in operation_messages


def test_firehose_asyncapi_artifact_is_in_sync() -> None:
    """The checked-in AsyncAPI file should match the Pydantic-derived contract."""
    assert ASYNCAPI_ARTIFACT.exists()

    artifact = json.loads(ASYNCAPI_ARTIFACT.read_text(encoding="utf-8"))

    assert artifact == build_firehose_asyncapi()


def test_export_firehose_asyncapi_writes_contract(tmp_path: Path) -> None:
    """The exporter should write a deterministic AsyncAPI artifact."""
    output_path = tmp_path / "firehose.asyncapi.json"

    exported_path = export_firehose_asyncapi(output_path)

    assert exported_path == output_path
    artifact = json.loads(output_path.read_text(encoding="utf-8"))
    assert artifact == build_firehose_asyncapi()
    assert output_path.read_text(encoding="utf-8").endswith("\n")
