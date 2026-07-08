"""Tests for the MCP Tasks extension: start_discovery_run + tasks/*."""

from __future__ import annotations

from unittest.mock import MagicMock

from atlas.platform.mcp.tasks import (
    _actor_claims_from_request_context,
)


class TestActorClaimsFromRequestContext:
    def test_returns_none_when_no_request(self) -> None:
        server = MagicMock()
        server.request_context.request = None
        assert _actor_claims_from_request_context(server) == (None, None)

    def test_returns_none_outside_request_context(self) -> None:
        server = MagicMock()
        type(server).request_context = property(lambda _self: (_ for _ in ()).throw(LookupError))
        assert _actor_claims_from_request_context(server) == (None, None)

    def test_extracts_org_id_and_user_id_from_payload(self) -> None:
        server = MagicMock()
        request = MagicMock()
        request.state.mcp_auth_payload = {"org_id": "org_1", "sub": "user_1"}
        server.request_context.request = request
        assert _actor_claims_from_request_context(server) == ("org_1", "user_1")
