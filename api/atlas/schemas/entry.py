"""Entry schemas for API requests and responses."""

from datetime import date

from pydantic import BaseModel, Field

from atlas.schemas.source import SourceResponse

__all__ = [
    "EntryCreateRequest",
    "EntryDetailResponse",
    "EntryListResponse",
    "EntryResponse",
    "EntrySearchFacets",
    "EntrySearchResponse",
    "EntryUpdateRequest",
    "FacetOption",
    "PaginationResponse",
]


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
    full_address: str | None = Field(None, description="Full public address", max_length=300)
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
        description="List of issue-area slugs",
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
    full_address: str | None = Field(None, description="Full public address")
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
    """Base entry response shared across summary and detail payloads."""

    id: str = Field(..., description="Entry ID")
    type: str = Field(..., description="Entry type")
    name: str = Field(..., description="Entry name")
    description: str = Field(..., description="Description")
    city: str | None = Field(None, description="City")
    state: str | None = Field(None, description="2-letter state code")
    region: str | None = Field(None, description="Regional name")
    full_address: str | None = Field(None, description="Full public address")
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
    issue_areas: list[str] = Field(
        default_factory=list,
        description="Issue-area slugs",
    )
    source_types: list[str] = Field(
        default_factory=list,
        description="Source-type slugs represented on this entry",
    )
    source_count: int = Field(0, description="Number of linked sources")
    latest_source_date: str | None = Field(
        None,
        description="Latest known source publication or ingestion date",
    )
    created_at: str = Field(..., description="Creation timestamp")
    updated_at: str = Field(..., description="Last update timestamp")


class EntryDetailResponse(EntryResponse):
    """Detailed entry response with source trail."""

    sources: list[SourceResponse] = Field(
        default_factory=list,
        description="Linked sources backing this entry",
    )


class FacetOption(BaseModel):
    """A single filter option with result count."""

    value: str = Field(..., description="Facet value")
    count: int = Field(..., description="Number of matching entries")


class EntrySearchFacets(BaseModel):
    """Available search facets for public entry search."""

    states: list[FacetOption] = Field(default_factory=list)
    cities: list[FacetOption] = Field(default_factory=list)
    regions: list[FacetOption] = Field(default_factory=list)
    issue_areas: list[FacetOption] = Field(default_factory=list)
    entity_types: list[FacetOption] = Field(default_factory=list)
    source_types: list[FacetOption] = Field(default_factory=list)


class PaginationResponse(BaseModel):
    """Pagination metadata for collection responses."""

    limit: int = Field(..., description="Requested page size")
    offset: int = Field(..., description="Requested page offset")
    total: int = Field(..., description="Total results matching the filter set")
    has_more: bool = Field(..., description="Whether more results are available")


class EntryListResponse(BaseModel):
    """Public-facing entry summary used in search results."""

    data: list[EntryResponse] = Field(default_factory=list)
    pagination: PaginationResponse
    facets: EntrySearchFacets


class EntrySearchResponse(EntryListResponse):
    """Alias for the public search response."""
