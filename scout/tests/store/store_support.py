"""Shared helpers for ScoutStore tests."""

from __future__ import annotations

from datetime import UTC, datetime


def _naive_datetime() -> datetime:
    return datetime(2025, 1, 2, 3, 4, 5, tzinfo=UTC).replace(tzinfo=None)
