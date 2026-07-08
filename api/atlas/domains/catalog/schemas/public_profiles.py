"""Public catalog profile and saved-list schemas."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .public_entities import EntityResponse  # noqa: TC001

__all__ = [
    "ProfileClaimRequest",
    "ProfileClaimResponse",
    "ProfileClaimVerifyRequest",
    "ProfileFollowResponse",
    "ProfileManageRequest",
    "SavedListCreateRequest",
    "SavedListExportItemResponse",
    "SavedListExportProvenance",
    "SavedListExportResponse",
    "SavedListExportSource",
    "SavedListItemRequest",
    "SavedListItemResponse",
    "SavedListResponse",
]


class ProfileClaimRequest(BaseModel):
    """Initiate a claim for a profile."""

    relationship: str | None = None
    evidence: str | None = None
    requested_changes: str | None = None
    preferred_contact_channel: str | None = None
    private_note: str | None = None


class ProfileClaimVerifyRequest(BaseModel):
    """Tier-1 email-link callback payload."""

    token: str


class ProfileClaimResponse(BaseModel):
    """Profile-claim resource."""

    id: str
    entry_id: str
    entry_slug: str | None = None
    entry_name: str
    user_id: str
    user_email: str
    status: str
    tier: int
    evidence: Any | None = None
    verified_at: str | None = None
    rejected_reason: str | None = None
    created_at: str
    updated_at: str


class ProfileManageRequest(BaseModel):
    """Subject-managed mutable fields on a claimed profile."""

    photo_url: str | None = None
    custom_bio: str | None = None
    suppressed_source_ids: list[str] | None = None
    preferred_contact_channel: str | None = None
    clear_photo: bool = Field(
        False,
        description="Set true to drop the existing photo_url. Photo_url field is ignored if true.",
    )
    clear_custom_bio: bool = Field(
        False,
        description="Set true to drop the existing custom_bio. The auto-generated description returns.",
    )


class SavedListCreateRequest(BaseModel):
    """Create a new saved-actor list."""

    name: str
    description: str | None = None


class SavedListItemRequest(BaseModel):
    """Add an entry to a saved list."""

    entry_id: str
    note: str | None = None


class SavedListItemResponse(BaseModel):
    """Single list-item record."""

    list_id: str
    entry_id: str
    note: str | None = None
    added_at: str
    entry: EntityResponse | None = None


class SavedListResponse(BaseModel):
    """Saved-list resource with item count."""

    id: str
    user_id: str
    name: str
    description: str | None = None
    item_count: int = 0
    items: list[SavedListItemResponse] = Field(default_factory=list)
    created_at: str
    updated_at: str


class SavedListExportProvenance(BaseModel):
    """Provenance summary for a saved-list export."""

    item_count: int = Field(0, ge=0)
    source_count: int = Field(0, ge=0)


class SavedListExportSource(BaseModel):
    """Source receipt included in a saved-list export row."""

    id: str
    url: str
    title: str | None = None
    publication: str | None = None
    type: str | None = None


class SavedListExportItemResponse(BaseModel):
    """Saved-list export row with actor, notes, and evidence receipts."""

    list_id: str
    entry_id: str
    note: str | None = None
    added_at: str
    entry: EntityResponse | None = None
    trust_level: str = "unverified"
    sources: list[SavedListExportSource] = Field(default_factory=list)


class SavedListExportResponse(BaseModel):
    """Downloadable saved-list export with hydrated actor rows."""

    model_config = ConfigDict(populate_by_name=True)

    format: Literal["json"] = "json"
    list_: SavedListResponse = Field(alias="list")
    items: list[SavedListExportItemResponse] = Field(default_factory=list)
    provenance: SavedListExportProvenance


class ProfileFollowResponse(BaseModel):
    """Follow subscription resource."""

    user_id: str
    entry_id: str
    subscribed_to: str
    created_at: str
