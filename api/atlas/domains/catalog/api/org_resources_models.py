"""Models for org-scoped private entry endpoints."""

from __future__ import annotations

import ipaddress
import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from atlas.schemas import EntityDetailResponse  # noqa: TC001

INVALID_DIRECTORY_DOMAIN_MESSAGE = "Enter a bare domain name, such as guide.example.org."
DIRECTORY_DOMAIN_MAX_LENGTH = 253
DIRECTORY_DOMAIN_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


def _normalize_directory_domain(value: str) -> str:
    """Return a validated, IDNA-normalized directory domain hostname."""
    domain = value.strip().lower()
    if (
        not domain
        or domain.endswith(".")
        or "*" in domain
        or "://" in domain
        or "/" in domain
        or any(char.isspace() for char in domain)
    ):
        raise ValueError(INVALID_DIRECTORY_DOMAIN_MESSAGE)

    try:
        ascii_domain = domain.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError(INVALID_DIRECTORY_DOMAIN_MESSAGE) from exc

    if len(ascii_domain) > DIRECTORY_DOMAIN_MAX_LENGTH or "." not in ascii_domain:
        raise ValueError(INVALID_DIRECTORY_DOMAIN_MESSAGE)

    try:
        ipaddress.ip_address(ascii_domain)
    except ValueError:
        pass
    else:
        raise ValueError(INVALID_DIRECTORY_DOMAIN_MESSAGE)

    labels = ascii_domain.split(".")
    if any(not DIRECTORY_DOMAIN_LABEL_RE.fullmatch(label) for label in labels):
        raise ValueError(INVALID_DIRECTORY_DOMAIN_MESSAGE)
    return ascii_domain


class PublishEntryResponse(BaseModel):
    """Response returned when a workspace entry's visibility changes."""

    entry_id: str
    visibility: str


class HeldPublishResponse(BaseModel):
    """Response detail returned when a tenant publish is held for review."""

    entry_id: str
    visibility: str = "private"
    hold_reason: str
    review_item_id: str


class PublicDirectoryDomain(BaseModel):
    """Verified custom domain exposed on a public directory."""

    domain: str
    status: str


class PublicDirectoryWorkspace(BaseModel):
    """Workspace identity exposed on a public directory."""

    id: str
    name: str
    custom_domain: PublicDirectoryDomain | None = None


class PublicDirectoryScope(BaseModel):
    """Derived public scope for a workspace directory."""

    issue_area_ids: list[str] = Field(default_factory=list)
    geography_labels: list[str] = Field(default_factory=list)
    entry_types: list[str] = Field(default_factory=list)


class PublicDirectoryStats(BaseModel):
    """Public counts that help visitors understand directory coverage."""

    record_count: int = Field(..., ge=0)
    source_count: int = Field(..., ge=0)
    source_backed_record_count: int = Field(..., ge=0)
    last_reviewed_at: str | None = None


class PublicDirectoryPublication(BaseModel):
    """Public/private boundary metadata for a directory."""

    visibility: Literal["public"] = "public"
    private_notes_exposed: bool = False


class PublicDirectoryMethodology(BaseModel):
    """Plain public methodology for how records qualify and can be corrected."""

    summary: str = "Records qualify after workspace review and linked source evidence."
    source_policy: str = "Every public record includes at least one linked source packet."
    review_policy: str = "Unsourced workspace records are held for review before publication."
    correction_policy: str = (
        "Each listed record accepts stale, incorrect, or missing-context feedback."
    )
    correction_path_template: str = "/feedback/{slug}?kind=incorrect"
    missing_context_path_template: str = "/feedback/{slug}?kind=missing_context"


class PublicDirectoryTrustFooter(BaseModel):
    """Trust footer metadata every tenant directory carries."""

    label: str = "Powered by Atlas"
    provenance_required: bool = True
    body: str = "Every listed profile keeps source packets and claim-level evidence."


class PublicDirectoryFederation(BaseModel):
    """Federation metadata for records shared back into the Atlas commons."""

    label: str = "Shared with the Atlas commons"
    shared_record_count: int = 0
    source_backed_record_count: int = 0
    review_required: bool = True
    status: str = "open_with_review_gate"
    minimum_confidence: str = "source-backed public record"
    provenance_stamped_ingestion: bool = True
    body: str = (
        "Public records from this directory can be reused by other Atlas-powered directories only "
        "with source evidence and workspace review."
    )


class PublicDirectoryResponse(BaseModel):
    """Public, source-linked directory published by a workspace."""

    title: str
    sponsor_label: str | None = None
    workspace: PublicDirectoryWorkspace
    scope: PublicDirectoryScope
    stats: PublicDirectoryStats
    publication: PublicDirectoryPublication = Field(default_factory=PublicDirectoryPublication)
    methodology: PublicDirectoryMethodology = Field(default_factory=PublicDirectoryMethodology)
    entries: list[EntityDetailResponse] = Field(default_factory=list)
    trust_footer: PublicDirectoryTrustFooter = Field(default_factory=PublicDirectoryTrustFooter)
    federation: PublicDirectoryFederation = Field(default_factory=PublicDirectoryFederation)


class DirectoryConfigRequest(BaseModel):
    """Editable public metadata for a workspace directory."""

    title: str | None = Field(default=None, min_length=1, max_length=140)
    sponsor_label: str | None = Field(default=None, min_length=1, max_length=180)
    scope: PublicDirectoryScope | None = None
    methodology: PublicDirectoryMethodology | None = None


class DirectoryConfigResponse(BaseModel):
    """Public directory configuration returned to workspace admins."""

    org_id: str
    title: str | None = None
    sponsor_label: str | None = None
    scope: PublicDirectoryScope = Field(default_factory=PublicDirectoryScope)
    methodology: PublicDirectoryMethodology = Field(default_factory=PublicDirectoryMethodology)
    updated_by: str | None = None
    updated_at: str | None = None


class DirectoryTemplatePlaceScope(BaseModel):
    """Place defaults seeded by a directory template."""

    geo_specificity: str
    city: str | None = None
    state: str | None = None
    region: str | None = None


class DirectoryTemplateResponse(BaseModel):
    """Template for starting a focused tenant directory."""

    id: str
    label: str
    description: str
    issue_area_ids: list[str]
    entry_types: list[str]
    place_scope: DirectoryTemplatePlaceScope


class DirectoryTemplatesResponse(BaseModel):
    """Collection of workspace directory templates."""

    templates: list[DirectoryTemplateResponse]


class DirectoryDomainRequest(BaseModel):
    """Custom domain a workspace wants to bind to its public directory."""

    domain: str = Field(min_length=3, max_length=253)

    @field_validator("domain")
    @classmethod
    def validate_domain(cls, value: str) -> str:
        """Normalize and reject values that are not bare hostnames."""
        return _normalize_directory_domain(value)


class DirectoryDomainResponse(BaseModel):
    """Custom domain verification state returned to workspace admins."""

    domain: str
    status: str
    verification_host: str
    verification_token: str


DIRECTORY_TEMPLATES = [
    DirectoryTemplateResponse(
        id="housing-coalition",
        label="Housing coalition map",
        description="Local housing actors, tenant organizations, public agencies, and partners.",
        issue_area_ids=["housing_affordability"],
        entry_types=["organization", "person", "initiative"],
        place_scope=DirectoryTemplatePlaceScope(geo_specificity="local"),
    ),
    DirectoryTemplateResponse(
        id="civic-newsroom-sourcebook",
        label="Civic newsroom sourcebook",
        description="Interview-ready people and organizations for a local reporting beat.",
        issue_area_ids=["civic_participation", "local_media"],
        entry_types=["person", "organization"],
        place_scope=DirectoryTemplatePlaceScope(geo_specificity="local"),
    ),
    DirectoryTemplateResponse(
        id="regional-ecosystem-map",
        label="Regional ecosystem map",
        description="Regional actors and initiatives across a multi-city issue landscape.",
        issue_area_ids=["workforce_development", "economic_development"],
        entry_types=["organization", "initiative", "campaign"],
        place_scope=DirectoryTemplatePlaceScope(geo_specificity="regional"),
    ),
]

__all__ = [
    "DIRECTORY_DOMAIN_LABEL_RE",
    "DIRECTORY_DOMAIN_MAX_LENGTH",
    "DIRECTORY_TEMPLATES",
    "INVALID_DIRECTORY_DOMAIN_MESSAGE",
    "DirectoryConfigRequest",
    "DirectoryConfigResponse",
    "DirectoryDomainRequest",
    "DirectoryDomainResponse",
    "DirectoryTemplatePlaceScope",
    "DirectoryTemplateResponse",
    "DirectoryTemplatesResponse",
    "HeldPublishResponse",
    "PublicDirectoryDomain",
    "PublicDirectoryFederation",
    "PublicDirectoryMethodology",
    "PublicDirectoryPublication",
    "PublicDirectoryResponse",
    "PublicDirectoryScope",
    "PublicDirectoryStats",
    "PublicDirectoryTrustFooter",
    "PublicDirectoryWorkspace",
    "PublishEntryResponse",
    "_normalize_directory_domain",
]
