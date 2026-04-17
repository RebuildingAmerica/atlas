"""Entity write schemas for API requests."""

from __future__ import annotations

from datetime import date  # noqa: TC003

from pydantic import BaseModel, Field, model_validator

from atlas.domains.catalog.schemas.public import Address, ContactInfo  # noqa: TC001

__all__ = ["EntityCreateRequest", "EntityUpdateRequest"]


class EntityCreateRequest(BaseModel):
    """Request to create an entity."""

    type: str = Field(
        ...,
        description="Entity type",
        examples=["person", "organization", "initiative", "campaign", "event"],
    )
    name: str = Field(..., description="Entity name", min_length=1)
    description: str = Field(
        ...,
        description="1-3 sentence description",
        min_length=10,
        max_length=500,
    )
    address: Address | None = None
    contact: ContactInfo | None = None
    city: str | None = Field(None, description="Legacy flat city", max_length=100)
    state: str | None = Field(None, description="Legacy flat state", min_length=2, max_length=2)
    geo_specificity: str | None = Field(None, description="Legacy flat geographic scope")
    region: str | None = Field(None, description="Legacy flat region", max_length=200)
    full_address: str | None = Field(None, description="Legacy flat full address", max_length=300)
    website: str | None = Field(None, description="Legacy flat website")
    email: str | None = Field(None, description="Legacy flat email")
    phone: str | None = Field(None, description="Legacy flat phone")
    social_media: dict[str, str] | None = Field(None, description="Legacy flat social media")
    affiliated_org_id: str | None = Field(None, description="Affiliated organization ID")
    issue_area_ids: list[str] = Field(default_factory=list, description="Canonical issue-area IDs")
    issue_areas: list[str] = Field(default_factory=list, description="Legacy issue-area slugs")
    first_seen: date | None = Field(None, description="First discovery date")
    last_seen: date | None = Field(None, description="Last discovery date")
    contact_status: str = Field("not_contacted", description="Contact status")
    editorial_notes: str | None = Field(None, description="Internal notes")
    priority: str | None = Field(None, description="Priority level")

    @model_validator(mode="after")
    def _normalize_nested_fields(self) -> EntityCreateRequest:
        if self.address is not None:
            self.city = self.address.city or self.city
            self.state = self.address.state or self.state
            self.region = self.address.region or self.region
            self.full_address = self.address.full_address or self.full_address
            self.geo_specificity = self.address.geo_specificity or self.geo_specificity
        if self.contact is not None:
            self.website = self.contact.website or self.website
            self.email = self.contact.email or self.email
            self.phone = self.contact.phone or self.phone
            self.social_media = self.contact.social_media or self.social_media
        if self.issue_area_ids and not self.issue_areas:
            self.issue_areas = list(self.issue_area_ids)
        if self.geo_specificity is None:
            raise ValueError("geo_specificity is required")  # noqa: TRY003
        return self


class EntityUpdateRequest(BaseModel):
    """Request to update an entity."""

    name: str | None = Field(None, description="Entity name")
    description: str | None = Field(None, description="Description")
    address: Address | None = None
    contact: ContactInfo | None = None
    city: str | None = Field(None, description="Legacy flat city")
    state: str | None = Field(None, description="Legacy flat state")
    geo_specificity: str | None = Field(None, description="Legacy flat geographic scope")
    region: str | None = Field(None, description="Legacy flat region")
    full_address: str | None = Field(None, description="Legacy flat full address")
    website: str | None = Field(None, description="Legacy flat website")
    email: str | None = Field(None, description="Legacy flat email")
    phone: str | None = Field(None, description="Legacy flat phone")
    social_media: dict[str, str] | None = Field(None, description="Legacy flat social media")
    active: bool | None = Field(None, description="Is entity active")
    verified: bool | None = Field(None, description="Is entity verified")
    contact_status: str | None = Field(None, description="Contact status")
    editorial_notes: str | None = Field(None, description="Internal notes")
    priority: str | None = Field(None, description="Priority level")

    @model_validator(mode="after")
    def _normalize_nested_fields(self) -> EntityUpdateRequest:
        if self.address is not None:
            self.city = self.address.city or self.city
            self.state = self.address.state or self.state
            self.region = self.address.region or self.region
            self.full_address = self.address.full_address or self.full_address
            self.geo_specificity = self.address.geo_specificity or self.geo_specificity
        if self.contact is not None:
            self.website = self.contact.website or self.website
            self.email = self.contact.email or self.email
            self.phone = self.contact.phone or self.phone
            self.social_media = self.contact.social_media or self.social_media
        return self
