"""Data transfer objects for Scout's browser-approved Atlas login flow."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

UploadTarget = Literal["public", "workspace"]


@dataclass(frozen=True, slots=True)
class DeviceCode:
    """Device authorization code response."""

    device_code: str
    user_code: str
    verification_uri: str
    verification_uri_complete: str | None
    expires_in: int
    interval: int


@dataclass(frozen=True, slots=True)
class DeviceToken:
    """Device authorization token response."""

    access_token: str
    token_type: str
    expires_in: int
    scope: str


@dataclass(frozen=True, slots=True)
class ScoutTokenExchange:
    """Atlas API token exchanged from a Scout browser-approved session."""

    token: str
    worker_id: str
    user_id: str
    user_email: str
    workspace_id: str | None = None


@dataclass(frozen=True, slots=True)
class ScoutSession:
    """Logged-in Atlas Scout worker session."""

    atlas_url: str
    access_token: str
    worker_id: str
    user_id: str
    user_email: str
    worker_name: str | None = None
    default_upload_target: UploadTarget | None = None
    workspace_id: str | None = None
