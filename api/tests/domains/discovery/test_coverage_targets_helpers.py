"""Tests for coverage target derivation helpers."""
# ruff: noqa

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from atlas.domains.discovery import coverage_targets as coverage_targets_module
from atlas.domains.discovery.coverage_targets import (
    CoverageTargetCRUD,
    CoverageTargetUpdate,
    StoredCoverageTargetDecodeError,
    _decode_json_object_list,
    _decode_json_string_list,
    _is_stale,
    _latest_recency_reference,
    _parse_datetime,
    derive_coverage_status,
)


@pytest.mark.parametrize(
    ("decoded", "error_message"),
    [
        ({"not": "a-list"}, "Expected a JSON string list."),
        (["ok", 1], "Expected a JSON string list."),
    ],
)
def test_decode_json_string_list_rejects_non_string_values(
    decoded: object,
    error_message: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Persisted string lists should fail closed on malformed JSON payloads."""
    monkeypatch.setattr(
        "atlas.domains.discovery.coverage_targets.db.decode_json",
        lambda _value: decoded,
    )

    with pytest.raises(StoredCoverageTargetDecodeError, match=error_message):
        _decode_json_string_list("[]")


@pytest.mark.parametrize(
    ("decoded", "error_message"),
    [
        ("not-a-list", "Expected a JSON object list."),
        (["ok"], "Expected each item to be an object."),
        ([{"label": 1}], "Expected string keys and values."),
    ],
)
def test_decode_json_object_list_rejects_invalid_payloads(
    decoded: object,
    error_message: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Persisted object lists should fail closed on malformed JSON payloads."""
    monkeypatch.setattr(
        "atlas.domains.discovery.coverage_targets.db.decode_json",
        lambda _value: decoded,
    )

    with pytest.raises(StoredCoverageTargetDecodeError, match=error_message):
        _decode_json_object_list("[]")


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ("2026-01-01T00:00:00Z", datetime(2026, 1, 1, tzinfo=UTC)),
        ("2026-01-01T00:00:00", datetime(2026, 1, 1, tzinfo=UTC)),
        ("bad-timestamp", None),
    ],
)
def test_parse_datetime_handles_timezone_and_invalid_values(
    value: str | None,
    expected: datetime | None,
) -> None:
    """Coverage timestamps should normalize to aware UTC datetimes."""
    assert _parse_datetime(value) == expected


def test_latest_recency_reference_prefers_the_most_recent_timestamp() -> None:
    """The newest run or review timestamp should drive stale checks."""
    first = datetime(2024, 1, 1, tzinfo=UTC)
    second = datetime(2024, 2, 1, tzinfo=UTC)
    assert _latest_recency_reference(first.isoformat(), second.isoformat()) == second
    assert _latest_recency_reference(None, None) is None


@pytest.mark.parametrize(
    ("age_days", "expected"),
    [
        (coverage_targets_module.COVERAGE_STALE_DAYS + 1, True),
        (coverage_targets_module.COVERAGE_STALE_DAYS - 1, False),
    ],
)
def test_is_stale_uses_the_operational_window(
    age_days: int,
    expected: bool,
) -> None:
    """Coverage freshness should be measured against the 90-day threshold."""
    reference = datetime.now(UTC) - timedelta(days=age_days)
    assert _is_stale(reference) is expected


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("runs", "entry_source_count", "last_reviewed_at", "expected_status"),
    [
        (
            [
                SimpleNamespace(
                    entries_confirmed=0,
                    sources_processed=0,
                    completed_at="2026-01-01T00:00:00Z",
                    started_at="2026-01-01T00:00:00Z",
                    status="failed",
                )
            ],
            0,
            None,
            "blocked",
        ),
        ([], 0, None, "unknown"),
        (
            [
                SimpleNamespace(
                    entries_confirmed=1,
                    sources_processed=1,
                    completed_at=datetime.now(UTC).isoformat(),
                    started_at=datetime.now(UTC).isoformat(),
                    status="completed",
                )
            ],
            1,
            None,
            "thin",
        ),
        (
            [
                SimpleNamespace(
                    entries_confirmed=4,
                    sources_processed=5,
                    completed_at="2024-01-01T00:00:00Z",
                    started_at="2024-01-01T00:00:00Z",
                    status="completed",
                )
            ],
            5,
            "2024-01-01T00:00:00Z",
            "stale",
        ),
        (
            [
                SimpleNamespace(
                    entries_confirmed=4,
                    sources_processed=5,
                    completed_at=datetime.now(UTC).isoformat(),
                    started_at=datetime.now(UTC).isoformat(),
                    status="completed",
                )
            ],
            5,
            None,
            "covered",
        ),
    ],
)
async def test_derive_coverage_status_covers_all_statuses(
    test_db: object,
    runs: list[SimpleNamespace],
    entry_source_count: int,
    last_reviewed_at: str | None,
    expected_status: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Status derivation should keep the public report language honest."""

    async def fake_get_by_id(_conn: object, _run_id: str) -> SimpleNamespace | None:
        return runs.pop(0) if runs else None

    async def fake_source_count(_conn: object, _linked_entry_ids: list[str]) -> int:
        return entry_source_count

    monkeypatch.setattr(coverage_targets_module.DiscoveryRunCRUD, "get_by_id", fake_get_by_id)
    monkeypatch.setattr(
        "atlas.domains.discovery.coverage_targets._source_count_for_entries",
        fake_source_count,
    )

    summary = await derive_coverage_status(
        test_db,
        linked_discovery_run_ids=["run-1"],
        linked_entry_ids=[],
        last_reviewed_at=last_reviewed_at,
    )

    assert summary.status == expected_status


@pytest.mark.asyncio
async def test_derive_coverage_status_tracks_latest_run_time(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Later runs should update the latest-run timestamp even when one is older."""
    runs = [
        SimpleNamespace(
            entries_confirmed=4,
            sources_processed=5,
            completed_at="2026-01-03T00:00:00Z",
            started_at="2026-01-03T00:00:00Z",
            status="completed",
        ),
        SimpleNamespace(
            entries_confirmed=2,
            sources_processed=3,
            completed_at="2026-01-01T00:00:00Z",
            started_at="2026-01-01T00:00:00Z",
            status="completed",
        ),
    ]

    async def fake_get_by_id(_conn: object, _run_id: str) -> SimpleNamespace | None:
        return runs.pop(0)

    async def fake_source_count(_conn: object, _linked_entry_ids: list[str]) -> int:
        return 5

    monkeypatch.setattr(coverage_targets_module.DiscoveryRunCRUD, "get_by_id", fake_get_by_id)
    monkeypatch.setattr(
        "atlas.domains.discovery.coverage_targets._source_count_for_entries",
        fake_source_count,
    )

    summary = await derive_coverage_status(
        test_db,
        linked_discovery_run_ids=["run-1", "run-2"],
        linked_entry_ids=[],
        last_reviewed_at=datetime.now(UTC).isoformat(),
    )

    assert summary.last_run_at == "2026-01-03T00:00:00Z"
    assert summary.status == "covered"


@pytest.mark.asyncio
async def test_update_returns_none_for_missing_target(
    test_db: object,
) -> None:
    """Missing targets should not invent records during an update."""
    update = CoverageTargetUpdate(
        name="Updated",
        geography="Kansas City, MO",
        issue_areas=["housing_affordability"],
        actor_types=["organization"],
        source_types=["community_archive"],
        gaps=[],
        next_actions=[],
        linked_discovery_run_ids=[],
        linked_entry_ids=[],
        last_reviewed_at=None,
        review_state="needs_research",
    )

    result = await CoverageTargetCRUD.update(test_db, "missing-target", update)

    assert result is None
