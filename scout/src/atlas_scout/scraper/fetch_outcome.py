"""Cached fetch outcome parsing and normalization."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from atlas_shared import SourceType


def parse_cached_datetime(value: Any) -> datetime | None:
    """Parse cached ISO datetimes back into ``datetime`` objects."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def parse_source_type(value: Any) -> SourceType:
    """Parse a stored source type string back into the enum."""
    if isinstance(value, SourceType):
        return value
    if isinstance(value, str):
        try:
            return SourceType(value)
        except ValueError:
            return SourceType.WEBSITE
    return SourceType.WEBSITE


def coerce_discovered_links(value: Any) -> list[str]:
    """Normalize cached discovered-link metadata into a string list."""
    if isinstance(value, list):
        return [str(item) for item in value if str(item)]
    return []


def coerce_discovery_articles(value: Any) -> list[dict[str, Any]]:
    """Normalize cached discovery-article metadata into record dictionaries."""
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]
