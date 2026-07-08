"""Typed models and constants for the MCP Tasks extension."""

from __future__ import annotations

from datetime import datetime  # noqa: TC003
from typing import Any, Literal

from mcp import types
from pydantic import BaseModel, ConfigDict, Field

from atlas.schemas import DiscoveryRunStartRequest

TASKS_EXTENSION = "io.modelcontextprotocol/tasks"
MISSING_REQUIRED_CLIENT_CAPABILITY = -32003

_TASK_TTL_MS = 30 * 60 * 1000
"""30 minutes: enough to cover queueing, backoff, and a full pipeline run."""

_TASK_POLL_INTERVAL_MS = 5_000
"""5 seconds: matches the LLM/browser-research latency of a discovery run."""

_TOOLS_PAGE_SIZE = 50
"""Generous default: today's 13 tools always fit on page one."""

_JOB_STATUS_TO_TASK_STATUS: dict[str, str] = {
    "queued": "working",
    "claimed": "working",
    "running": "working",
    "completed": "completed",
    "failed": "completed",
    "cancelled": "cancelled",
}

_REQUIRED_TASKS_CAPABILITY_DATA: dict[str, Any] = {
    "requiredCapabilities": {"extensions": {TASKS_EXTENSION: {}}},
}

DraftTaskStatus = Literal["working", "input_required", "completed", "cancelled", "failed"]

_START_DISCOVERY_RUN_TOOL = types.Tool(
    name="start_discovery_run",
    description=(
        "Trigger an Atlas discovery run for a place and issue areas. Requires "
        "the MCP Tasks extension and returns a task handle immediately; poll "
        "tasks/get until it completes. Metered against the calling org's "
        "monthly discovery budget."
    ),
    inputSchema=DiscoveryRunStartRequest.model_json_schema(),
)


class DraftTask(BaseModel):
    """Task shape from the draft ``io.modelcontextprotocol/tasks`` extension."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    task_id: str = Field(alias="taskId")
    status: DraftTaskStatus
    status_message: str | None = Field(default=None, alias="statusMessage")
    created_at: datetime = Field(alias="createdAt")
    last_updated_at: datetime = Field(alias="lastUpdatedAt")
    ttl_ms: int | None = Field(alias="ttlMs")
    poll_interval_ms: int | None = Field(default=None, alias="pollIntervalMs")


class DraftCreateTaskResult(BaseModel):
    """Draft CreateTaskResult: a flat result discriminator plus task fields."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    result_type: Literal["task"] = Field(default="task", alias="resultType")
    task: DraftTask
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None

    def model_dump(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        """Serialize as ``Result & Task`` instead of nesting under ``task``."""
        dump_kwargs = dict(kwargs)
        dump_kwargs.setdefault("by_alias", True)
        data = self.task.model_dump(*args, **dump_kwargs)
        data["resultType"] = self.result_type
        if self.result is not None:
            data["result"] = self.result
        if self.error is not None:
            data["error"] = self.error
        return data


class DraftGetTaskResult(DraftTask):
    """Draft tasks/get result with status-specific payload fields."""

    result_type: Literal["complete"] = Field(default="complete", alias="resultType")
    input_requests: dict[str, Any] | None = Field(default=None, alias="inputRequests")
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


class DraftEmptyResult(BaseModel):
    """Draft empty acknowledgement result."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    result_type: Literal["complete"] = Field(default="complete", alias="resultType")


DraftResultRoot = DraftCreateTaskResult | DraftGetTaskResult | DraftEmptyResult


class DiscoveryRunPreflight(BaseModel):
    """Form-mode confirmation before starting a budgeted discovery run."""

    confirm_run: bool = Field(
        title="Start discovery run",
        description="Confirm using a monthly discovery run.",
    )
    location_query: str | None = Field(
        default=None,
        title="Place",
        description="City and state, state, county, or region.",
        max_length=120,
    )
    state: str | None = Field(
        default=None,
        title="State",
        description="Two-letter state code.",
        min_length=2,
        max_length=2,
    )
    issue_areas: list[str] | None = Field(
        default=None,
        title="Issue areas",
        description="Atlas issue area slugs for this run.",
    )
    research_goal: str | None = Field(
        default=None,
        title="Research goal",
        description="The research job this run should support.",
        max_length=80,
    )
    search_depth: str | None = Field(
        default=None,
        title="Search depth",
        description="standard or deep.",
        max_length=20,
    )


class DraftServerResult:
    """Small response wrapper compatible with MCP session serialization."""

    def __init__(self, root: DraftResultRoot) -> None:
        self.root = root

    def model_dump(self, **kwargs: Any) -> dict[str, Any]:
        """Return the wrapped draft result in JSON-RPC ``result`` shape."""
        dump_kwargs = dict(kwargs)
        dump_kwargs.setdefault("by_alias", True)
        return self.root.model_dump(**dump_kwargs)


McpHandlerResult = types.ServerResult | DraftServerResult
