"""Discovery run schemas for API requests and responses."""

from __future__ import annotations

from typing import Literal

from atlas_shared import DiscoveryRunInput
from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "DiscoveryRunResponse",
    "DiscoveryRunStartRequest",
    "DiscoveryScheduleCollectionResponse",
    "DiscoveryScheduleCreateRequest",
    "DiscoveryScheduleResponse",
    "DiscoveryScheduleUpdateRequest",
    "ScheduledRunResponse",
]


class DiscoveryRunStartRequest(DiscoveryRunInput):
    """Request to start a discovery run."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "location_query": "Kansas City, MO",
                "state": "MO",
                "issue_areas": [
                    "worker_cooperatives",
                    "housing_affordability",
                    "local_government_and_civic_engagement",
                ],
                "search_depth": "standard",
            }
        }
    )


class DiscoveryRunResponse(BaseModel):
    """Discovery run response model."""

    id: str = Field(..., description="Discovery run ID")
    location_query: str = Field(..., description="Location query")
    state: str = Field(..., description="State code")
    issue_areas: list[str] = Field(..., description="Issue areas queried")
    queries_generated: int = Field(..., description="Search queries generated")
    sources_fetched: int = Field(..., description="Sources fetched")
    sources_processed: int = Field(..., description="Sources processed")
    entries_extracted: int = Field(..., description="Entries extracted")
    entries_after_dedup: int = Field(..., description="Entries after deduplication")
    entries_confirmed: int = Field(..., description="Entries confirmed")
    started_at: str = Field(..., description="Start timestamp")
    completed_at: str | None = Field(None, description="Completion timestamp")
    status: str = Field(..., description="Status (running, completed, failed)")
    error_message: str | None = Field(None, description="Error message if failed")
    created_at: str = Field(..., description="Creation timestamp")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440002",
                "location_query": "Kansas City, MO",
                "state": "MO",
                "issue_areas": ["worker_cooperatives", "housing_affordability"],
                "queries_generated": 150,
                "sources_fetched": 45,
                "sources_processed": 42,
                "entries_extracted": 38,
                "entries_after_dedup": 35,
                "entries_confirmed": 30,
                "started_at": "2026-01-15T10:00:00+00:00",
                "completed_at": "2026-01-15T12:30:00+00:00",
                "status": "completed",
                "created_at": "2026-01-15T10:00:00+00:00",
            }
        }
    )


class DiscoveryScheduleCreateRequest(BaseModel):
    """Request to create a discovery schedule target."""

    location_query: str = Field(..., description="Location query (e.g. 'Austin, TX')")
    state: str = Field(..., min_length=2, max_length=2, description="2-letter state code")
    issue_areas: list[str] = Field(..., min_length=1, description="Issue area slugs to discover")
    search_depth: Literal["standard", "deep"] = Field(
        "standard", description="Search depth for query generation"
    )


class DiscoveryScheduleUpdateRequest(BaseModel):
    """Partial update for a discovery schedule target."""

    location_query: str | None = None
    state: str | None = Field(None, min_length=2, max_length=2)
    issue_areas: list[str] | None = None
    search_depth: Literal["standard", "deep"] | None = None
    enabled: bool | None = None


class DiscoveryScheduleResponse(BaseModel):
    """A discovery schedule target."""

    id: str
    location_query: str
    state: str
    issue_areas: list[str]
    search_depth: str
    enabled: bool
    last_run_id: str | None = None
    last_run_at: str | None = None
    created_at: str
    updated_at: str


class DiscoveryScheduleCollectionResponse(BaseModel):
    """Collection of discovery schedule targets."""

    items: list[DiscoveryScheduleResponse]
    total: int


class DiscoveryJobResponse(BaseModel):
    """A discovery pipeline job."""

    id: str
    run_id: str
    status: str
    progress: dict[str, object] | None = None
    error_message: str | None = None
    retry_count: int = 0
    max_retries: int = 2
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None


class DiscoveryPipelineSummaryResponse(BaseModel):
    """Aggregate pipeline health summary."""

    queued_jobs: int = 0
    running_jobs: int = 0
    failed_jobs: int = 0
    completed_runs_total: int = 0
    total_entries_confirmed: int = 0
    last_completed_run_at: str | None = None
    enabled_schedules: int = 0


class ScheduledRunResult(BaseModel):
    """Result of one scheduled pipeline execution."""

    schedule_id: str
    run_id: str
    status: str
    entries_confirmed: int = 0


class ScheduledRunResponse(BaseModel):
    """Response from the scheduled trigger endpoint."""

    runs_started: int
    results: list[ScheduledRunResult]
