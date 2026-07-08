"""Shared test helpers for MCP server tests."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

from atlas.platform.mcp.elicitation import CLIENT_CAPABILITIES_META_KEY

EXPECTED_TOOL_NAMES = {
    "create_coverage_target",
    "create_research_brief",
    "export_coverage_report",
    "export_research_brief",
    "get_discovery_run",
    "search_entities",
    "get_entity",
    "get_entity_sources",
    "list_discovery_runs",
    "search_sources",
    "get_place_entities",
    "get_place_profile",
    "get_place_coverage",
    "get_place_issue_signals",
    "get_related_entities",
    "open_api_key_settings",
    "open_billing_settings",
    "require_api_key_settings",
    "resolve_issue_areas",
    "save_entities_to_list",
    "start_discovery_run",
    "sync_scout_artifacts",
    "watch_workspace_resource",
}

EXPECTED_ASGI_APP_MIDDLEWARE_COUNT = 3  # draft-Tasks, auth, CORS

HTTP_UNAUTHORIZED = 401

HTTP_FORBIDDEN = 403

HTTP_OK = 200


def _url_elicitation_meta() -> dict[str, object]:
    return {CLIENT_CAPABILITIES_META_KEY: {"elicitation": {"url": {}}}}


class FakeUrlContext:
    def __init__(self, *, action: str, meta: dict[str, object] | None = None) -> None:
        self.actions: list[dict[str, str]] = []
        self.session = SimpleNamespace(send_elicit_complete=AsyncMock())
        self.request_context = SimpleNamespace(
            meta=meta,
            session=self.session,
            request=SimpleNamespace(
                state=SimpleNamespace(mcp_auth_payload={"org_id": "org_1", "sub": "user_1"})
            ),
        )
        self._action = action

    async def elicit_url(self, *, message: str, url: str, elicitation_id: str) -> object:
        self.actions.append({"message": message, "url": url, "elicitation_id": elicitation_id})
        return SimpleNamespace(action=self._action)


class FakeBrokenRequestContext:
    @property
    def request_context(self) -> object:
        raise ValueError


class FakeMissingRequestContext:
    request_context = SimpleNamespace(request=None, meta={"ok": True})
