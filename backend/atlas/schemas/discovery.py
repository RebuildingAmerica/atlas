"""Discovery run schemas for API requests and responses."""

from pydantic import BaseModel, Field

__all__ = ["DiscoveryRunResponse", "DiscoveryRunStartRequest"]


class DiscoveryRunStartRequest(BaseModel):
    """Request to start a discovery run."""

    location_query: str = Field(
        ...,
        description="Location query (e.g., 'Kansas City, MO')",
        examples=["Kansas City, MO", "New York, NY"],
    )
    state: str = Field(
        ...,
        description="2-letter state code",
        min_length=2,
        max_length=2,
    )
    issue_areas: list[str] = Field(
        ...,
        description="List of issue area slugs to query",
        min_items=1,
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "location_query": "Kansas City, MO",
                "state": "MO",
                "issue_areas": [
                    "worker_cooperatives",
                    "housing_affordability",
                    "local_government_and_civic_engagement",
                ],
            }
        }
    }


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

    model_config = {
        "json_schema_extra": {
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
    }
