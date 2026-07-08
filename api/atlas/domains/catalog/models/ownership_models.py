"""Resource ownership and organization annotation models."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from atlas.platform.database import db

logger = logging.getLogger(__name__)

__all__ = [
    "AnnotationModel",
    "AnnotationTargetError",
    "DirectoryConfigModel",
    "DirectoryDomainAlreadyClaimedError",
    "DirectoryDomainModel",
    "OwnershipModel",
    "PublicDirectoryIndexModel",
    "_decode_string_list",
]


class AnnotationTargetError(ValueError):
    """Raised when a private note target is missing or ambiguous."""


class DirectoryDomainAlreadyClaimedError(ValueError):
    """Raised when a workspace tries to claim another workspace's directory domain."""


@dataclass
class OwnershipModel:
    """Resource ownership record."""

    resource_id: str
    resource_type: str
    org_id: str
    visibility: str
    created_by: str
    created_at: str


@dataclass
class AnnotationModel:
    """Organization annotation on a shared entry or source."""

    id: str
    org_id: str
    entry_id: str | None
    source_id: str | None
    target_type: str
    target_id: str
    content: str
    author_id: str
    created_at: str
    updated_at: str


@dataclass
class DirectoryDomainModel:
    """Custom domain ownership record for a public workspace directory."""

    org_id: str
    domain: str
    verification_token: str
    status: str
    created_at: str
    verified_at: str | None


@dataclass
class DirectoryConfigModel:
    """Editable public metadata for a workspace directory."""

    org_id: str
    title: str | None
    sponsor_label: str | None
    issue_area_ids: list[str]
    geography_labels: list[str]
    entry_types: list[str]
    methodology_summary: str | None
    source_policy: str | None
    review_policy: str | None
    correction_policy: str | None
    correction_path_template: str | None
    missing_context_path_template: str | None
    created_by: str
    updated_by: str
    created_at: str
    updated_at: str


@dataclass
class PublicDirectoryIndexModel:
    """Public directory summary used by indexing and sitemap surfaces."""

    org_id: str
    record_count: int
    last_published_at: str | None


def _decode_string_list(data: str, field_name: str) -> list[str]:
    """Decode a persisted JSON string list or fail on malformed data."""
    decoded = db.decode_json(data)
    if not isinstance(decoded, list) or not all(isinstance(item, str) for item in decoded):
        msg = f"{field_name} must contain a JSON array of strings"
        raise ValueError(msg)
    return decoded
