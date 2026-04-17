"""Pydantic schemas for API request/response types."""

from atlas.domains.catalog.schemas.entry import EntityCreateRequest, EntityUpdateRequest
from atlas.domains.catalog.schemas.public import (
    DiscoveryRunCollectionResponse,
    DomainDetailResponse,
    DomainListResponse,
    DomainResponse,
    EntityCollectionResponse,
    EntityFlagCreateRequest,
    EntityFlagListResponse,
    EntitySourcesResponse,
    FlagResponse,
    IssueAreaListResponse,
    IssueAreaResponse,
    IssueSignalsResponse,
    PlaceCoverageResponse,
    PlaceIdentityResponse,
    PlaceProfileResponse,
    SourceCollectionResponse,
    SourceFlagCreateRequest,
    SourceFlagListResponse,
)
from atlas.domains.catalog.schemas.public import (
    EntityDetailResponse as PublicEntityDetailResponse,
)
from atlas.domains.catalog.schemas.public import (
    EntityResponse as PublicEntityResponse,
)
from atlas.domains.catalog.schemas.public import (
    SourceResponse as PublicSourceResponse,
)
from atlas.schemas.discovery import (
    DiscoveryRunResponse,
    DiscoveryRunStartRequest,
)
from atlas.schemas.entry import (
    EntryCreateRequest,
    EntryDetailResponse,
    EntryListResponse,
    EntryResponse,
    EntrySearchFacets,
    EntrySearchResponse,
    EntryUpdateRequest,
    FacetOption,
    PaginationResponse,
)

EntityDetailResponse = PublicEntityDetailResponse
EntityResponse = PublicEntityResponse
SourceResponse = PublicSourceResponse

__all__ = [
    "DiscoveryRunCollectionResponse",
    "DiscoveryRunResponse",
    "DiscoveryRunStartRequest",
    "DomainDetailResponse",
    "DomainListResponse",
    "DomainResponse",
    "EntityCollectionResponse",
    "EntityCreateRequest",
    "EntityDetailResponse",
    "EntityFlagCreateRequest",
    "EntityFlagListResponse",
    "EntityResponse",
    "EntitySourcesResponse",
    "EntityUpdateRequest",
    "EntryCreateRequest",
    "EntryDetailResponse",
    "EntryListResponse",
    "EntryResponse",
    "EntrySearchFacets",
    "EntrySearchResponse",
    "EntryUpdateRequest",
    "FacetOption",
    "FlagResponse",
    "IssueAreaListResponse",
    "IssueAreaResponse",
    "IssueSignalsResponse",
    "PaginationResponse",
    "PlaceCoverageResponse",
    "PlaceIdentityResponse",
    "PlaceProfileResponse",
    "SourceCollectionResponse",
    "SourceFlagCreateRequest",
    "SourceFlagListResponse",
    "SourceResponse",
]
