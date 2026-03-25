"""Entry schemas for API requests and responses."""

from datetime import date

from pydantic import BaseModel, Field

__all__ = ["EntryCreateRequest", "EntryResponse", "EntryUpdateRequest"]


class EntryCreateRequest(BaseModel):
    """Request to create an entry."""

    type: str = Field(
        ...,
        description="Entry type",
        examples=["person", "organization", "initiative", "campaign", "event"],
    )
    name: str = Field(..., description="Entry name", min_length=1)
    description: str = Field(
        ...,
        description="1-3 sentence description",
        min_length=10,
        max_length=500,
    )
    city: str | None = Field(None, description="City", max_length=100)
    state: str | None = Field(None, description="2-letter state code", min_length=2, max_length=2)
    geo_specificity: str = Field(
        ...,
        description="Geographic scope",
        examples=["local", "regional", "statewide", "national"],
    )
    region: str | None = Field(None, description="Regional name", max_length=200)
    website: str | None = Field(None, description="Website URL")
    email: str | None = Field(None, description="Email address")
    phone: str | None = Field(None, description="Phone number")
    social_media: dict[str, str] | None = Field(
        None,
        description="Social media handles {platform: handle}",
    )
    affiliated_org_id: str | None = Field(None, description="Affiliated organization ID")
    issue_areas: list[str] = Field(
        default_factory=list,
        description="List of issue area slugs",
    )
    first_seen: date | None = Field(None, description="First discovery date")
    last_seen: date | None = Field(None, description="Last discovery date")
    contact_status: str = Field(
        "not_contacted",
        description="Contact status",
    )
    editorial_notes: str | None = Field(None, description="Internal notes")
    priority: str | None = Field(None, description="Priority level")

    model_config = {
        "json_schema_extra": {
            "example": {
                "type": "organization",
                "name": "Prairie Workers Cooperative",
                "description": "Worker-owned cooperative providing cleaning and food services in Garden City, KS.",
                "city": "Garden City",
                "state": "KS",
                "geo_specificity": "local",
                "website": "https://prairieworkers.coop",
                "email": "info@prairieworkers.coop",
                "issue_areas": ["worker_cooperatives", "automation_and_ai_displacement"],
            }
        }
    }


class EntryUpdateRequest(BaseModel):
    """Request to update an entry."""

    name: str | None = Field(None, description="Entry name")
    description: str | None = Field(None, description="Description")
    city: str | None = Field(None, description="City")
    state: str | None = Field(None, description="2-letter state code")
    geo_specificity: str | None = Field(None, description="Geographic scope")
    region: str | None = Field(None, description="Regional name")
    website: str | None = Field(None, description="Website URL")
    email: str | None = Field(None, description="Email address")
    phone: str | None = Field(None, description="Phone number")
    social_media: dict[str, str] | None = Field(None, description="Social media handles")
    active: bool | None = Field(None, description="Is entry active")
    verified: bool | None = Field(None, description="Is entry verified")
    contact_status: str | None = Field(None, description="Contact status")
    editorial_notes: str | None = Field(None, description="Internal notes")
    priority: str | None = Field(None, description="Priority level")


class EntryResponse(BaseModel):
    """Entry response model."""

    id: str = Field(..., description="Entry ID")
    type: str = Field(..., description="Entry type")
    name: str = Field(..., description="Entry name")
    description: str = Field(..., description="Description")
    city: str | None = Field(None, description="City")
    state: str | None = Field(None, description="2-letter state code")
    region: str | None = Field(None, description="Regional name")
    geo_specificity: str = Field(..., description="Geographic scope")
    website: str | None = Field(None, description="Website URL")
    email: str | None = Field(None, description="Email address")
    phone: str | None = Field(None, description="Phone number")
    social_media: dict[str, str] | None = Field(None, description="Social media handles")
    affiliated_org_id: str | None = Field(None, description="Affiliated organization ID")
    active: bool = Field(..., description="Is active")
    verified: bool = Field(..., description="Is verified")
    last_verified: str | None = Field(None, description="Last verification date")
    first_seen: str = Field(..., description="First discovery date")
    last_seen: str = Field(..., description="Last discovery date")
    contact_status: str = Field(..., description="Contact status")
    editorial_notes: str | None = Field(None, description="Internal notes")
    priority: str | None = Field(None, description="Priority level")
    issue_areas: list[str] = Field(
        default_factory=list,
        description="Issue area slugs",
    )
    created_at: str = Field(..., description="Creation timestamp")
    updated_at: str = Field(..., description="Last update timestamp")

    model_config = {
        "json_schema_extra": {
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "type": "organization",
                "name": "Prairie Workers Cooperative",
                "description": "Worker-owned cooperative in Garden City, KS.",
                "city": "Garden City",
                "state": "KS",
                "geo_specificity": "local",
                "website": "https://prairieworkers.coop",
                "email": "info@prairieworkers.coop",
                "active": True,
                "verified": False,
                "issue_areas": ["worker_cooperatives"],
                "created_at": "2026-01-15T10:30:00+00:00",
                "updated_at": "2026-01-15T10:30:00+00:00",
            }
        }
    }
