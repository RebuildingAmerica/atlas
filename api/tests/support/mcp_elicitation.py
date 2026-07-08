"""Shared test helpers for Atlas MCP elicitation tests."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from atlas.platform.mcp.elicitation import CLIENT_CAPABILITIES_META_KEY


def _meta(capabilities: dict[str, Any]) -> dict[str, Any]:
    return {CLIENT_CAPABILITIES_META_KEY: capabilities}


QUICK_RESULT_LIMIT = 10
STANDARD_RESULT_LIMIT = 20
DEEP_RESULT_LIMIT = 50
SELECTED_ISSUE_COUNT = 2


def _assert_log_omits_private_values(log_kwargs: dict[str, Any], values: set[str]) -> None:
    rendered = repr(log_kwargs)
    for value in values:
        assert value not in rendered


class FakeElicitationContext:
    def __init__(self, *, meta: object | None, result: object) -> None:
        self.request_context = SimpleNamespace(meta=meta)
        self.result = result
        self.messages: list[str] = []
        self.schemas: list[type[object]] = []

    async def elicit(self, *, message: str, schema: type[object]) -> object:
        self.messages.append(message)
        self.schemas.append(schema)
        return self.result


class BrokenContext:
    @property
    def request_context(self) -> object:
        raise ValueError
