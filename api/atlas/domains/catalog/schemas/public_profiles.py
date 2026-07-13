"""Public catalog profile and saved-list schemas."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .public_entities import EntityResponse  # noqa: TC001

__all__ = [
    "AtprotoIdentityLinkRequest",
    "AtprotoIdentityProfileSummary",
    "AtprotoIdentityResponse",
    "AtprotoIdentitySignInResolveRequest",
    "AtprotoIdentitySignInResolveResponse",
    "ProfileAtprotoIdentityAttachRequest",
    "ProfileAtprotoIdentityLinkResponse",
    "ProfileAtprotoRevalidationResponse",
    "ProfileClaimDomainVerifyRequest",
    "ProfileClaimProofRequest",
    "ProfileClaimProofResponse",
    "ProfileClaimRequest",
    "ProfileClaimResponse",
    "ProfileClaimReviewDecisionRequest",
    "ProfileClaimReviewListResponse",
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


class AtprotoIdentityLinkRequest(BaseModel):
    """Persist a DID-backed ATProto identity linked by the authenticated user."""

    did: str
    current_handle: str
    pds_url: str | None = None


class AtprotoIdentityResponse(BaseModel):
    """Account-visible state for one controlled ATProto identity."""

    id: str
    did: str
    current_handle: str
    pds_url: str | None = None
    resolution_status: Literal["verified", "needs_attention"]
    control_status: Literal["active", "conflict"]
    connected_at: str
    verified_at: str | None = None
    last_checked_at: str | None = None
    last_resolution_error: str | None = None
    profiles: list[AtprotoIdentityProfileSummary] = Field(default_factory=list)


class AtprotoIdentitySignInResolveRequest(BaseModel):
    """Internal callback proof for resolving an active DID controller."""

    did: str


class AtprotoIdentitySignInResolveResponse(BaseModel):
    """Internal-only Atlas account selected by a verified ATProto DID."""

    user_id: str


class AtprotoIdentityProfileSummary(BaseModel):
    """Profile currently represented by an account identity."""

    id: str
    name: str
    slug: str
    type: str


class OrganizationAtprotoIdentityAttachRequest(BaseModel):
    """Attach one verified account-controlled identity to an organization."""

    identity_id: str


class AtprotoIdentityDelegationRequest(BaseModel):
    """Grant one member authority to administer an organization identity."""

    delegate_user_id: str


class OrganizationAtprotoIdentityResponse(BaseModel):
    """Auditable organization ownership state for one ATProto identity."""

    id: str
    organization_id: str
    identity_id: str
    status: Literal["active", "removed"]
    attached_by: str
    attached_at: str
    detached_by: str | None = None
    detached_at: str | None = None


class AtprotoIdentityDelegationResponse(BaseModel):
    """Workspace-scoped, revocable administration delegation."""

    id: str
    organization_id: str
    identity_id: str
    controller_user_id: str
    delegate_user_id: str
    status: Literal["active", "revoked"]
    granted_by: str
    granted_at: str
    revoked_by: str | None = None
    revoked_at: str | None = None


class ProfileClaimRequest(BaseModel):
    """Start profile verification."""

    relationship: str | None = None
    evidence: str | None = None
    requested_changes: str | None = None
    preferred_contact_channel: str | None = None
    private_note: str | None = None
    atproto_identity_id: str | None = Field(
        None,
        description="DID-backed ATProto identity linked by the authenticated user.",
    )
    dns_domain: str | None = Field(
        None,
        description="Organization domain verified with an Atlas TXT record.",
    )
    use_active_workspace: bool = Field(
        False,
        description="Use the authenticated active workspace as organization-admin proof.",
    )


class ProfileClaimProofRequest(BaseModel):
    """Request body for a profile verification proof check."""

    txt_records: list[str] = Field(default_factory=list)


class ProfileClaimDomainVerifyRequest(ProfileClaimProofRequest):
    """Compatibility model for DNS record verification requests."""


class ProfileClaimVerifyRequest(BaseModel):
    """Tier-1 email-link callback payload."""

    token: str


class ProfileClaimReviewDecisionRequest(BaseModel):
    """Reviewer decision payload for a pending profile verification."""

    note: str | None = None


class ProfileClaimProofResponse(BaseModel):
    """One proof record supporting a profile verification decision."""

    id: str
    proof_type: str
    proof_status: str
    proof_summary: str
    metadata: Any | None = None
    created_at: str
    reviewed_at: str | None = None
    expires_at: str | None = None


class ProfileClaimResponse(BaseModel):
    """Profile verification resource."""

    id: str
    entry_id: str
    entry_slug: str | None = None
    entry_name: str
    user_id: str
    user_email: str
    status: str
    tier: int
    evidence: Any | None = None
    proofs: list[ProfileClaimProofResponse] = Field(default_factory=list)
    linked_atproto_handle: str | None = None
    linked_atproto_did: str | None = None
    linked_atproto_verified_at: str | None = None
    verified_at: str | None = None
    rejected_reason: str | None = None
    created_at: str
    updated_at: str


class ProfileClaimReviewListResponse(BaseModel):
    """Pending profile verifications for reviewer action."""

    items: list[ProfileClaimResponse] = Field(default_factory=list)
    total: int


class ProfileAtprotoRevalidationResponse(BaseModel):
    """Result from rechecking linked ATProto profile identities."""

    checked: int
    needs_attention: int


class ProfileAtprotoIdentityAttachRequest(BaseModel):
    """Explicit request to attach or replace a profile's public identity."""

    atproto_identity_id: str
    replace: bool = False


class ProfileAtprotoIdentityLinkResponse(BaseModel):
    """Auditable public identity relation managed by a verified steward."""

    identity_id: str
    did: str
    current_handle: str
    status: Literal["verified", "reverification_required"]
    verified_at: str | None = None


class ProfileManageRequest(BaseModel):
    """Representative updates for a verified profile."""

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
