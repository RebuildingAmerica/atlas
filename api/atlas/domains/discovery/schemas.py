"""Discovery run schemas for API requests and responses."""

from __future__ import annotations

from typing import Literal

from atlas_shared import DiscoveryResearchGoal, DiscoveryRunInput
from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "DiscoveryJobQueueItemResponse",
    "DiscoveryJobQueueResponse",
    "DiscoveryResearchGap",
    "DiscoveryResearchLead",
    "DiscoveryResearchSource",
    "DiscoveryResearchSummary",
    "DiscoveryRunCancelResponse",
    "DiscoveryRunResponse",
    "DiscoveryRunStartRequest",
    "DiscoveryScheduleCollectionResponse",
    "DiscoveryScheduleCreateRequest",
    "DiscoveryScheduleResponse",
    "DiscoveryScheduleUpdateRequest",
    "ScheduledRunResponse",
    "ScheduledRunResult",
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
                "research_goal": "landscape_scan",
                "search_depth": "standard",
            }
        }
    )


class DiscoveryResearchLead(BaseModel):
    """A ranked actor lead from a discovery run."""

    entry_id: str = Field(..., description="Entry ID for the lead")
    name: str = Field(..., description="Lead name")
    type: str = Field(..., description="Lead entry type")
    why_it_matters: str = Field(..., description="Source-backed reason this lead is relevant")
    source_count: int = Field(..., ge=0, description="Number of supporting sources")
    confidence: Literal["corroborated", "partial", "unverified"] = Field(
        "unverified",
        description="Conservative confidence state derived from visible supporting evidence.",
    )
    latest_source_date: str | None = Field(None, description="Most recent source date")


class DiscoveryResearchSource(BaseModel):
    """A source that strongly shaped a discovery run's output."""

    source_id: str = Field(..., description="Source ID")
    title: str = Field(..., description="Source title")
    url: str = Field(..., description="Source URL")
    publication: str | None = Field(None, description="Publication or source publisher")
    published_date: str | None = Field(None, description="Published date")
    why_it_matters: str = Field(..., description="Why this source matters to the brief")


class DiscoveryResearchGap(BaseModel):
    """A research gap found during a discovery run."""

    label: str = Field(..., description="Gap label")
    detail: str = Field(..., description="Plain-language gap detail")


class DiscoveryResearchSummary(BaseModel):
    """Structured, source-linked research output from a discovery run."""

    brief: str = Field(..., description="Concise source-linked research brief")
    ranked_leads: list[DiscoveryResearchLead] = Field(default_factory=list)
    key_sources: list[DiscoveryResearchSource] = Field(default_factory=list)
    gaps: list[DiscoveryResearchGap] = Field(default_factory=list)
    reasoning_signals: list[str] = Field(default_factory=list)


class DiscoveryRunResponse(BaseModel):
    """Discovery run response model."""

    id: str = Field(..., description="Discovery run ID")
    location_query: str = Field(..., description="Location query")
    state: str = Field(..., description="State code")
    research_goal: DiscoveryResearchGoal = Field(..., description="Research job this run supports")
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
    research_summary: DiscoveryResearchSummary | None = Field(
        None,
        description="Structured research output with leads, sources, gaps, and reasoning signals",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440002",
                "location_query": "Kansas City, MO",
                "state": "MO",
                "research_goal": "landscape_scan",
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
                "research_summary": {
                    "brief": "Three source-backed housing leads in Kansas City.",
                    "ranked_leads": [
                        {
                            "entry_id": "entry_123",
                            "name": "KC Tenants",
                            "type": "organization",
                            "why_it_matters": "Named by city and community sources.",
                            "source_count": 2,
                            "latest_source_date": "2026-01-15",
                        }
                    ],
                    "key_sources": [],
                    "gaps": [],
                    "reasoning_signals": ["Two independent sources point to the same actor."],
                },
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

    location_query: str | None = Field(None, description="Location query (e.g. 'Austin, TX')")
    state: str | None = Field(None, min_length=2, max_length=2, description="2-letter state code")
    issue_areas: list[str] | None = Field(None, description="Issue area slugs to discover")
    search_depth: Literal["standard", "deep"] | None = Field(
        None, description="Search depth for query generation"
    )
    enabled: bool | None = Field(None, description="Whether this schedule is active")


class DiscoveryScheduleResponse(BaseModel):
    """A discovery schedule target."""

    id: str = Field(..., description="Schedule ID")
    location_query: str = Field(..., description="Location query")
    state: str = Field(..., description="2-letter state code")
    issue_areas: list[str] = Field(..., description="Issue area slugs")
    search_depth: str = Field(..., description="Search depth (standard or deep)")
    enabled: bool = Field(..., description="Whether this schedule is active")
    last_run_id: str | None = Field(None, description="ID of the most recent run")
    last_run_at: str | None = Field(None, description="Timestamp of the most recent run")
    created_at: str = Field(..., description="Creation timestamp")
    updated_at: str = Field(..., description="Last update timestamp")


class DiscoveryScheduleCollectionResponse(BaseModel):
    """Collection of discovery schedule targets."""

    items: list[DiscoveryScheduleResponse] = Field(..., description="Schedule targets")
    total: int = Field(..., description="Total number of schedules")


class DiscoveryJobResponse(BaseModel):
    """A discovery pipeline job."""

    id: str = Field(..., description="Job ID")
    run_id: str = Field(..., description="Associated discovery run ID")
    status: str = Field(..., description="Job status (queued, claimed, running, completed, failed)")
    progress: dict[str, object] | None = Field(None, description="Current step and metrics")
    error_message: str | None = Field(None, description="Error message if failed")
    retry_count: int = Field(0, description="Number of retry attempts so far")
    max_retries: int = Field(2, description="Maximum retry attempts before permanent failure")
    created_at: str = Field(..., description="Creation timestamp")
    started_at: str | None = Field(None, description="Execution start timestamp")
    completed_at: str | None = Field(None, description="Completion timestamp")


class DiscoveryJobQueueItemResponse(DiscoveryJobResponse):
    """A discovery pipeline job with research target context."""

    location_query: str = Field(..., description="Run location query")
    state: str = Field(..., description="Run state")
    issue_areas: list[str] = Field(..., description="Run issue area slugs")
    claimed_by: str | None = Field(None, description="Worker that claimed the job")
    claimed_until: str | None = Field(None, description="Current worker lease expiration")
    next_attempt_at: str | None = Field(None, description="Earliest retry claim timestamp")


class DiscoveryJobQueueResponse(BaseModel):
    """Research-operations queue view for discovery jobs."""

    items: list[DiscoveryJobQueueItemResponse] = Field(..., description="Recent active jobs")
    total: int = Field(..., ge=0, description="Total queued, claimed, running, and failed jobs")
    status_counts: dict[str, int] = Field(
        ..., description="Queued, claimed, running, and failed job counts"
    )


class DiscoveryRunCancelResponse(BaseModel):
    """Result of cancelling a discovery run's jobs."""

    run_id: str = Field(..., description="The discovery run whose jobs were cancelled")
    jobs_cancelled: int = Field(..., description="Number of non-terminal jobs moved to cancelled")


class DiscoveryPipelineSummaryResponse(BaseModel):
    """Aggregate pipeline health summary."""

    queued_jobs: int = Field(0, description="Jobs waiting to be claimed")
    running_jobs: int = Field(0, description="Jobs currently executing")
    failed_jobs: int = Field(0, description="Jobs that failed permanently")
    completed_runs_total: int = Field(0, description="Total completed discovery runs")
    total_entries_confirmed: int = Field(0, description="Sum of confirmed entries across all runs")
    last_completed_run_at: str | None = Field(
        None, description="Timestamp of the most recently completed run"
    )
    enabled_schedules: int = Field(0, description="Number of enabled schedule targets")


class ScheduledRunResult(BaseModel):
    """The durable job enqueued for one scheduled target."""

    schedule_id: str = Field(..., description="Schedule target that triggered this run")
    run_id: str = Field(..., description="Discovery run ID created for this execution")
    job_id: str = Field(..., description="Queued discovery job ID the worker will execute")


class ScheduledRunResponse(BaseModel):
    """Response from the scheduled trigger endpoint.

    The trigger enqueues durable jobs and returns immediately; the durable
    worker performs the discovery work. ``enqueued`` counts the jobs queued by
    this invocation, including same-day re-triggers that reused an existing job.
    """

    enqueued: int = Field(..., description="Number of durable jobs enqueued for schedule targets")
    results: list[ScheduledRunResult] = Field(..., description="Per-target enqueued jobs")
