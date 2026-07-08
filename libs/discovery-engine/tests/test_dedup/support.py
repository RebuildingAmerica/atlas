"""Shared helpers for deduplication tests."""

from __future__ import annotations

from typing import Any


def _entry(
    *,
    name: str,
    city: str | None = "Austin",
    entry_type: str = "organization",
    affiliated_org: str | None = None,
    description: str = "",
    issue_areas: list[str] | None = None,
    source_urls: list[str] | None = None,
    source_dates: list[Any] | None = None,
    source_contexts: dict[str, str] | None = None,
    social_media: dict[str, str] | None = None,
    last_seen: Any = None,
    website: str | None = None,
    email: str | None = None,
) -> dict[str, Any]:
    return {
        "name": name,
        "city": city,
        "entry_type": entry_type,
        "affiliated_org": affiliated_org,
        "description": description,
        "issue_areas": issue_areas or [],
        "source_urls": source_urls or [],
        "source_dates": source_dates or [],
        "source_contexts": source_contexts or {},
        "social_media": social_media,
        "last_seen": last_seen,
        "website": website,
        "email": email,
    }
