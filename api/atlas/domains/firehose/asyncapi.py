"""Generate the Firehose AsyncAPI contract."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from .http import (
    FIREHOSE_SSE_RETRY_MS,
    FIREHOSE_WEBSOCKET_PROTOCOL,
    SUPPORTED_FIREHOSE_REPRESENTATIONS,
)
from .schemas import (
    FirehoseActorRef,
    FirehoseDeliveryRequest,
    FirehoseDestination,
    FirehoseEvidence,
    FirehoseHeartbeatEvent,
    FirehoseLinkSet,
    FirehoseQuery,
    FirehoseReadyEvent,
    FirehoseSession,
    FirehoseSessionRequest,
    FirehoseSignal,
    FirehoseSignalEvent,
    FirehoseSnapshot,
    FirehoseSummary,
    FirehoseUsageContext,
    FirehoseWorkspaceContext,
)

PROJECT_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_OUTPUT_PATH = PROJECT_ROOT / "asyncapi" / "firehose.asyncapi.json"

JsonObject = dict[str, Any]
SchemaModel = type[BaseModel]


def _model_schema(model: SchemaModel) -> JsonObject:
    """Return a Pydantic JSON Schema with AsyncAPI component references."""
    schema = model.model_json_schema(ref_template="#/components/schemas/{model}")
    schema.pop("$defs", None)
    return schema


def _json_message(*, title: str, summary: str, schema_name: str) -> JsonObject:
    """Build a reusable JSON event message definition."""
    return {
        "title": title,
        "summary": summary,
        "contentType": "application/json",
        "payload": {"$ref": f"#/components/schemas/{schema_name}"},
    }


def _session_id_parameter() -> JsonObject:
    """Build the reusable session id channel parameter."""
    return {
        "description": "Durable Firehose session id returned by POST /api/firehose/sessions.",
        "schema": {"type": "string", "pattern": "^fhs_[a-f0-9]{24}$"},
    }


def _headers_schema() -> JsonObject:
    """Build the request headers shared by Firehose streaming transports."""
    return {
        "type": "object",
        "properties": {
            "Accept": {
                "type": "string",
                "description": "Use text/event-stream for Server-Sent Events.",
            },
            "Authorization": {"type": "string"},
            "X-API-Key": {"type": "string"},
            "X-Request-ID": {"type": "string"},
            "Last-Event-ID": {"type": "string"},
            "Prefer": {
                "type": "string",
                "description": "Supports wait, return=minimal, and return=representation.",
            },
            "Traceparent": {"type": "string"},
            "Tracestate": {"type": "string"},
        },
        "additionalProperties": True,
    }


def _query_schema() -> JsonObject:
    """Build the query parameter schema for top-level Firehose observation."""
    return {
        "type": "object",
        "properties": {
            "place": {"type": "array", "items": {"type": "string"}},
            "issue": {"type": "array", "items": {"type": "string"}},
            "actor_type": {"type": "array", "items": {"type": "string"}},
            "signal_type": {"type": "array", "items": {"type": "string"}},
            "source_class": {"type": "array", "items": {"type": "string"}},
            "visibility": {"type": "string"},
            "since": {"type": "string"},
            "until": {"type": "string"},
            "cursor": {"type": "string"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 200},
            "sort": {"type": "string"},
        },
        "additionalProperties": False,
    }


def _sse_binding() -> JsonObject:
    """Build the AsyncAPI HTTP binding metadata for Firehose SSE channels."""
    return {
        "http": {
            "method": "GET",
            "bindingVersion": "0.3.0",
            "headers": _headers_schema(),
            "query": _query_schema(),
        }
    }


def _websocket_binding() -> JsonObject:
    """Build the AsyncAPI WebSocket binding metadata for Firehose sockets."""
    return {
        "ws": {
            "method": "GET",
            "bindingVersion": "0.1.0",
            "query": _query_schema(),
            "headers": {
                "allOf": [
                    _headers_schema(),
                    {
                        "type": "object",
                        "properties": {
                            "Sec-WebSocket-Protocol": {
                                "type": "string",
                                "const": FIREHOSE_WEBSOCKET_PROTOCOL,
                            }
                        },
                    },
                ]
            },
        }
    }


def _schemas() -> JsonObject:
    """Build Pydantic-derived schema components for Firehose messages."""
    models: tuple[SchemaModel, ...] = (
        FirehoseActorRef,
        FirehoseDeliveryRequest,
        FirehoseDestination,
        FirehoseEvidence,
        FirehoseHeartbeatEvent,
        FirehoseLinkSet,
        FirehoseQuery,
        FirehoseReadyEvent,
        FirehoseSession,
        FirehoseSessionRequest,
        FirehoseSignal,
        FirehoseSignalEvent,
        FirehoseSnapshot,
        FirehoseSummary,
        FirehoseUsageContext,
        FirehoseWorkspaceContext,
    )
    return {model.__name__: _model_schema(model) for model in models}


def build_firehose_asyncapi() -> JsonObject:
    """Build the AsyncAPI contract for Firehose streaming transports."""
    return {
        "asyncapi": "3.0.0",
        "info": {
            "title": "Atlas Firehose Protocol",
            "version": "0.1.0",
            "description": (
                "Message contract for source-backed Firehose observations over "
                "Server-Sent Events and WebSockets."
            ),
        },
        "defaultContentType": "application/json",
        "servers": {
            "atlasApi": {
                "host": "atlas.rebuildingus.org",
                "protocol": "https",
                "pathname": "/",
            }
        },
        "channels": {
            "firehoseQueryEvents": {
                "address": "/api/firehose",
                "title": "Top-level Firehose SSE stream",
                "messages": {
                    "FirehoseReady": {"$ref": "#/components/messages/FirehoseReady"},
                    "FirehoseSignalReceived": {
                        "$ref": "#/components/messages/FirehoseSignalReceived"
                    },
                    "FirehoseHeartbeat": {"$ref": "#/components/messages/FirehoseHeartbeat"},
                },
                "bindings": _sse_binding(),
            },
            "firehoseSessionEvents": {
                "address": "/api/firehose/sessions/{session_id}/events",
                "title": "Durable Firehose session SSE stream",
                "parameters": {"session_id": _session_id_parameter()},
                "messages": {
                    "FirehoseReady": {"$ref": "#/components/messages/FirehoseReady"},
                    "FirehoseSignalReceived": {
                        "$ref": "#/components/messages/FirehoseSignalReceived"
                    },
                    "FirehoseHeartbeat": {"$ref": "#/components/messages/FirehoseHeartbeat"},
                },
                "bindings": _sse_binding(),
            },
            "firehoseSessionSocket": {
                "address": "/api/firehose/sessions/{session_id}/socket",
                "title": "Durable Firehose WebSocket",
                "parameters": {"session_id": _session_id_parameter()},
                "messages": {
                    "FirehoseReady": {"$ref": "#/components/messages/FirehoseReady"},
                    "FirehoseSignalReceived": {
                        "$ref": "#/components/messages/FirehoseSignalReceived"
                    },
                    "FirehoseHeartbeat": {"$ref": "#/components/messages/FirehoseHeartbeat"},
                },
                "bindings": _websocket_binding(),
            },
        },
        "operations": {
            "receiveTopLevelFirehoseEvents": {
                "action": "receive",
                "channel": {"$ref": "#/channels/firehoseQueryEvents"},
                "messages": [
                    {"$ref": "#/components/messages/FirehoseReady"},
                    {"$ref": "#/components/messages/FirehoseSignalReceived"},
                    {"$ref": "#/components/messages/FirehoseHeartbeat"},
                ],
            },
            "receiveSessionFirehoseEvents": {
                "action": "receive",
                "channel": {"$ref": "#/channels/firehoseSessionEvents"},
                "messages": [
                    {"$ref": "#/components/messages/FirehoseReady"},
                    {"$ref": "#/components/messages/FirehoseSignalReceived"},
                    {"$ref": "#/components/messages/FirehoseHeartbeat"},
                ],
            },
            "receiveSessionFirehoseSocketEvents": {
                "action": "receive",
                "channel": {"$ref": "#/channels/firehoseSessionSocket"},
                "messages": [
                    {"$ref": "#/components/messages/FirehoseReady"},
                    {"$ref": "#/components/messages/FirehoseSignalReceived"},
                    {"$ref": "#/components/messages/FirehoseHeartbeat"},
                ],
            },
        },
        "components": {
            "messages": {
                "FirehoseReady": _json_message(
                    title="Firehose ready",
                    summary="The stream is open for a source-backed Firehose query.",
                    schema_name="FirehoseReadyEvent",
                ),
                "FirehoseHeartbeat": _json_message(
                    title="Firehose heartbeat",
                    summary="The stream remains open with no newer signal to deliver.",
                    schema_name="FirehoseHeartbeatEvent",
                ),
                "FirehoseSignalReceived": _json_message(
                    title="Firehose signal received",
                    summary="A source-backed civic signal matched the Firehose query.",
                    schema_name="FirehoseSignalEvent",
                ),
            },
            "schemas": _schemas(),
            "securitySchemes": {
                "apiKey": {"type": "apiKey", "in": "header", "name": "X-API-Key"},
                "bearerJwt": {"type": "http", "scheme": "bearer"},
            },
        },
        "security": [{"apiKey": []}, {"bearerJwt": []}],
        "x-atlas": {
            "representations": SUPPORTED_FIREHOSE_REPRESENTATIONS.split(", "),
            "sseRetryMs": FIREHOSE_SSE_RETRY_MS,
            "websocketSubprotocol": FIREHOSE_WEBSOCKET_PROTOCOL,
        },
    }


def export_firehose_asyncapi(output_path: Path = DEFAULT_OUTPUT_PATH) -> Path:
    """Write the deterministic Firehose AsyncAPI artifact.

    Parameters
    ----------
    output_path:
        Destination for the generated JSON document.

    Returns
    -------
    Path
        The path written by the exporter.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(build_firehose_asyncapi(), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return output_path


def main() -> None:
    """Generate the checked-in Firehose AsyncAPI artifact."""
    output_path = export_firehose_asyncapi()
    sys.stdout.write(f"Wrote {output_path}\n")


if __name__ == "__main__":
    main()
