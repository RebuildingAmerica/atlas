"""Date normalization helpers for database and API boundaries."""

from __future__ import annotations

from datetime import date, datetime


def coerce_date(value: date | datetime | str | None) -> date | None:
    """Normalize database driver date values to ``date`` when possible."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def require_date(value: date | datetime | str) -> date:
    """Normalize a required database date value or fail explicitly."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(value[:10])


def date_string(value: date | datetime | str | None) -> str | None:
    """Normalize database driver date values to public ISO date strings."""
    normalized = coerce_date(value)
    return normalized.isoformat() if normalized is not None else None


def row_timestamp_string(value: date | datetime | str | None) -> str | None:
    """Normalize database driver timestamp values to strings."""
    if value is None:
        return None
    if isinstance(value, datetime | date):
        return value.isoformat()
    return value
