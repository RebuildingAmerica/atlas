"""Shared date coercion coverage for Postgres and SQLite boundary values."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from atlas.platform.dates import date_string, require_date, row_timestamp_string


def test_date_string_canonicalizes_database_driver_values() -> None:
    """Public serializers should get one date string regardless of database driver."""
    assert date_string("2026-01-14") == "2026-01-14"
    assert date_string("2026-01-14T12:30:00+00:00") == "2026-01-14"
    assert date_string(date(2026, 1, 14)) == "2026-01-14"
    assert date_string(datetime(2026, 1, 14, 12, 30, tzinfo=UTC)) == "2026-01-14"
    assert date_string(None) is None
    assert date_string("not-a-date") is None


def test_require_date_rejects_invalid_required_values() -> None:
    """Row mappers should fail loudly when required DATE columns are invalid."""
    assert require_date("2026-02-01T01:02:03+00:00") == date(2026, 2, 1)

    with pytest.raises(ValueError, match="Invalid isoformat string"):
        require_date("not-a-date")


def test_row_timestamp_string_canonicalizes_timestamp_values() -> None:
    """Row timestamp fields should become strings before leaving model mappers."""
    assert row_timestamp_string(datetime(2026, 3, 4, 5, 6, tzinfo=UTC)) == (
        "2026-03-04T05:06:00+00:00"
    )
    assert row_timestamp_string("2026-03-04T05:06:00+00:00") == ("2026-03-04T05:06:00+00:00")
    assert row_timestamp_string(None) is None
