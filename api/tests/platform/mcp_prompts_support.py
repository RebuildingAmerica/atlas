from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from mcp import types

from atlas.platform.mcp.elicitation import CLIENT_CAPABILITIES_META_KEY

EXPECTED_PROMPT_NAMES = {
    "assess_coverage_gaps",
    "create_research_brief",
    "find_civic_actors",
    "inspect_source_trail",
    "research_place",
}


def _handler_for(mcp: object, request_type: type) -> object:
    """Return the low-level request handler registered for a request type."""
    return mcp._mcp_server.request_handlers[request_type]  # type: ignore[attr-defined] # noqa: SLF001


async def _list_prompts(mcp: object, cursor: str | None = None) -> types.ListPromptsResult:
    """Call the low-level prompts/list handler."""
    handler = _handler_for(mcp, types.ListPromptsRequest)
    request = types.ListPromptsRequest.model_validate(
        {"method": "prompts/list", "params": {"cursor": cursor} if cursor is not None else {}}
    )
    result = await handler(request)  # type: ignore[operator]
    return result.root


async def _get_prompt(
    mcp: object,
    name: str,
    arguments: dict[str, str] | None = None,
    meta: dict[str, Any] | None = None,
) -> types.GetPromptResult:
    """Call the low-level prompts/get handler."""
    handler = _handler_for(mcp, types.GetPromptRequest)
    request = types.GetPromptRequest.model_validate(
        {
            "method": "prompts/get",
            "params": {
                "name": name,
                "arguments": arguments or {},
                **({"_meta": meta} if meta is not None else {}),
            },
        }
    )
    result = await handler(request)  # type: ignore[operator]
    return result.root


def _elicitation_meta() -> dict[str, Any]:
    return {CLIENT_CAPABILITIES_META_KEY: {"elicitation": {"form": {}}}}


def _prompt_candidate_meta() -> dict[str, Any]:
    meta = _elicitation_meta()
    meta["atlas"] = {
        "promptCandidates": {
            "entity": [
                {"const": "entry_kc_tenants", "title": "KC Tenants"},
                {"const": "entry_kc_transit", "title": "KC Transit Riders"},
            ],
            "run_id": [
                {"const": "run_kc", "title": "Kansas City tenant power"},
                {"const": "run_lv", "title": "Las Vegas food systems"},
            ],
        }
    }
    return meta


class PromptCandidateMetaModel:
    def model_dump(self, *, by_alias: bool) -> dict[str, Any]:
        assert by_alias is True
        return {
            "atlas": {
                "promptCandidates": {
                    "entity": [
                        " entry_plain ",
                        {"const": " entry_titled ", "title": " Titled entry "},
                        {"const": " entry_without_title ", "title": ""},
                        "",
                    ]
                }
            }
        }


class FakePromptElicitationSession:
    def __init__(self, result: types.ElicitResult) -> None:
        self.result = result
        self.calls: list[dict[str, Any]] = []

    async def elicit_form(
        self,
        *,
        message: str,
        requestedSchema: dict[str, Any],  # noqa: N803
        related_request_id: object,
    ) -> types.ElicitResult:
        self.calls.append(
            {
                "message": message,
                "requestedSchema": requestedSchema,
                "related_request_id": related_request_id,
            }
        )
        return self.result


class FakePromptMcp:
    def __init__(self, result: types.ElicitResult) -> None:
        self.session = FakePromptElicitationSession(result)
        self._mcp_server = MagicMock()
        self._mcp_server.request_context = MagicMock(session=self.session, request_id="req_1")


class FakePromptMcpWithoutContext:
    class Server:
        @property
        def request_context(self) -> object:
            raise LookupError

    _mcp_server = Server()
