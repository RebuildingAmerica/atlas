"""Timestamp/ID helpers shared across every store repository.

Internal to the store package — not part of its public surface.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime


def now() -> str:
    """Return the current UTC time as an ISO 8601 string."""
    return datetime.now(UTC).isoformat()


def new_id() -> str:
    """Generate a short random hex ID (12 characters)."""
    return uuid.uuid4().hex[:12]


def serialize_timestamp(value: datetime | None) -> str | None:
    """Normalize an optional timezone-aware timestamp to UTC ISO 8601."""
    if value is None:
        return None
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("timestamps must be timezone-aware")
    return value.astimezone(UTC).isoformat()
