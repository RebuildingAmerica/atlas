"""Structured request logging."""

from __future__ import annotations

import json
import logging
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from atlas.platform.observability import (
    REQUEST_ID_HEADER,
    JsonLogFormatter,
    configure_json_logging,
    current_request_id,
    log_requests,
    request_id_var,
)


def _always_raises() -> None:
    """Raise so the caller can capture real exc_info."""
    raise ValueError


def _captured_value_error() -> tuple[type[BaseException], BaseException, object]:
    """Return real exc_info for a raised ValueError."""
    try:
        _always_raises()
    except ValueError:
        return sys.exc_info()  # type: ignore[return-value]
    raise AssertionError


def _record(**kwargs: object) -> logging.LogRecord:
    """Build a LogRecord with optional `extra`-style attributes."""
    record = logging.LogRecord(
        name="atlas.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="hello %s",
        args=("world",),
        exc_info=None,
    )
    for key, value in kwargs.items():
        setattr(record, key, value)
    return record


class TestJsonLogFormatter:
    """The formatter has to produce one queryable JSON object per line."""

    def test_emits_the_fields_cloud_run_reads(self) -> None:
        """Cloud Run lifts severity and message specifically."""
        payload = json.loads(JsonLogFormatter().format(_record()))

        assert payload["severity"] == "INFO"
        assert payload["message"] == "hello world"
        assert payload["logger"] == "atlas.test"
        assert payload["time"].endswith("Z")

    def test_folds_in_extra_fields(self) -> None:
        """Anything a caller attached with extra= belongs in the payload."""
        payload = json.loads(JsonLogFormatter().format(_record(http_status=503)))

        assert payload["http_status"] == 503

    def test_omits_the_request_id_when_none_is_bound(self) -> None:
        """A log line outside a request should not carry an empty id."""
        payload = json.loads(JsonLogFormatter().format(_record()))

        assert "request_id" not in payload

    def test_includes_the_bound_request_id(self) -> None:
        """Lines emitted during a request carry its id."""
        token = request_id_var.set("abc123")
        try:
            payload = json.loads(JsonLogFormatter().format(_record()))
        finally:
            request_id_var.reset(token)

        assert payload["request_id"] == "abc123"

    def test_renders_an_exception(self) -> None:
        """A failure keeps its traceback inside the record."""
        record = _record()
        record.exc_info = _captured_value_error()

        payload = json.loads(JsonLogFormatter().format(record))

        assert "ValueError" in payload["exception"]

    def test_serializes_values_json_cannot_encode(self) -> None:
        """An unserializable extra must not lose the whole line."""
        payload = json.loads(JsonLogFormatter().format(_record(weird=object())))

        assert "object object" in payload["weird"]


class TestConfigureJsonLogging:
    """Handler setup has to be idempotent."""

    def test_replaces_handlers_rather_than_stacking_them(self) -> None:
        """Repeated calls would otherwise duplicate every line."""
        root = logging.getLogger()
        original = list(root.handlers)
        original_level = root.level
        try:
            configure_json_logging()
            configure_json_logging()

            assert len(root.handlers) == 1
            assert isinstance(root.handlers[0].formatter, JsonLogFormatter)
            assert root.level == logging.INFO
        finally:
            for handler in list(root.handlers):
                root.removeHandler(handler)
            for handler in original:
                root.addHandler(handler)
            root.setLevel(original_level)


class TestRequestLogging:
    """Every request gets an id, a line, and the id echoed back."""

    @pytest.fixture
    def client(self) -> TestClient:
        """An app carrying only the logging middleware."""
        app = FastAPI()
        app.middleware("http")(log_requests)

        @app.get("/ok")
        async def ok() -> dict[str, str]:
            return {"request_id": current_request_id()}

        @app.get("/boom")
        async def boom() -> dict[str, str]:
            raise RuntimeError

        return TestClient(app, raise_server_exceptions=False)

    def test_generates_and_echoes_a_request_id(self, client: TestClient) -> None:
        """A caller with no id gets one, and can correlate on it."""
        response = client.get("/ok")

        assert response.status_code == 200
        echoed = response.headers[REQUEST_ID_HEADER]
        assert echoed
        assert response.json()["request_id"] == echoed

    def test_honours_a_caller_supplied_id(self, client: TestClient) -> None:
        """A gateway's id should survive so traces join up."""
        response = client.get("/ok", headers={REQUEST_ID_HEADER: "edge-abc.1"})

        assert response.headers[REQUEST_ID_HEADER] == "edge-abc.1"

    def test_rejects_an_id_that_could_forge_a_log_line(self, client: TestClient) -> None:
        """The header is caller-controlled, so structure characters are dropped."""
        response = client.get("/ok", headers={REQUEST_ID_HEADER: 'a" bad\nid'})

        assert response.headers[REQUEST_ID_HEADER] != 'a" bad\nid'

    def test_truncates_an_oversized_id(self, client: TestClient) -> None:
        """A huge id would otherwise bloat every line of the request."""
        response = client.get("/ok", headers={REQUEST_ID_HEADER: "x" * 500})

        assert len(response.headers[REQUEST_ID_HEADER]) <= 200

    def test_logs_a_completed_request(
        self, client: TestClient, caplog: pytest.LogCaptureFixture
    ) -> None:
        """The line names the route and status, which a stack trace does not."""
        with caplog.at_level(logging.INFO, logger="atlas.request"):
            client.get("/ok")

        record = next(r for r in caplog.records if r.message == "Request completed")
        assert record.http_path == "/ok"
        assert record.http_status == 200
        assert record.duration_ms >= 0

    def test_logs_a_failing_request_with_its_route(
        self, client: TestClient, caplog: pytest.LogCaptureFixture
    ) -> None:
        """An outage should produce a record naming the path that broke."""
        with caplog.at_level(logging.ERROR, logger="atlas.request"):
            client.get("/boom")

        record = next(r for r in caplog.records if r.message == "Request failed")
        assert record.http_path == "/boom"
        assert record.exc_info is not None

    def test_unbinds_the_id_after_the_request(self, client: TestClient) -> None:
        """A leaked id would tag unrelated background work."""
        client.get("/ok")

        assert current_request_id() == ""
