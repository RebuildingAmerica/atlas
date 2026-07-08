"""Coverage tests for `atlas.platform.mcp.data` helper functions."""
# ruff: noqa

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from atlas.platform.mcp import data as data_module
from atlas.platform.mcp.data import AGING_DAYS, DatabaseSession, normalize_place_key


@pytest.mark.asyncio
async def test_database_session_opens_and_closes(db_url: str) -> None:
    """`DatabaseSession` must yield a connection and close it on exit."""
    async with DatabaseSession(db_url) as conn:
        cursor = await conn.execute("SELECT 1")
        row = await cursor.fetchone()
        assert row == (1,)


@pytest.mark.asyncio
async def test_database_session_aexit_without_aenter_is_safe(db_url: str) -> None:
    """`__aexit__` must tolerate the no-connection state."""
    session = DatabaseSession(db_url)
    await session.__aexit__(None, None, None)


def test_place_resource_slug_state_only_uses_short_path() -> None:
    """`_place_resource_slug` returns the state slug directly when city is absent."""
    assert (
        data_module._place_resource_slug({"city": None, "state": "IN", "region": None})  # noqa: SLF001
        == "in"
    )


def test_place_context_lookup_key_handles_kind_prefixes() -> None:
    """Kind-specific place keys should only prefix non-polity lookups."""
    assert data_module._place_context_lookup_key("gary-in", None) == "gary-in"  # noqa: SLF001
    assert data_module._place_context_lookup_key("gary-in", "polity") == "gary-in"  # noqa: SLF001
    assert data_module._place_context_lookup_key("gary-in", "city") == "city:gary-in"  # noqa: SLF001


def test_append_source_place_clauses_uses_filters_or_falls_back_to_false_clause() -> None:
    """Source place filters should emit exact predicates or a hard false clause."""
    clauses: list[str] = []
    params: list[object] = []

    data_module._append_source_place_clauses(  # noqa: SLF001
        clauses=clauses,
        params=params,
        normalized_place={"city": None, "state": None, "region": None},
        place_filters=[{"state": "IN", "city": "Gary", "region": None}],
    )
    assert clauses == ["(e.state = ? AND e.city = ?)"]
    assert params == ["IN", "Gary"]

    clauses = []
    params = []
    data_module._append_source_place_clauses(  # noqa: SLF001
        clauses=clauses,
        params=params,
        normalized_place={"city": None, "state": None, "region": None},
        place_filters=[{"state": None, "city": None, "region": None}],
    )
    assert clauses == ["0 = 1"]
    assert params == []


def test_source_place_filter_clause_skips_empty_filters_and_keeps_params() -> None:
    """Exact place filters should skip empty rows and preserve comparison order."""
    params: list[object] = []
    clause = data_module._source_place_filter_clause(  # noqa: SLF001
        [
            {"state": "IN", "city": "Gary", "region": None},
            {"state": None, "city": None, "region": None},
            {"state": "IN", "city": None, "region": "Midwest"},
        ],
        params,
    )

    assert clause == "(e.state = ? AND e.city = ?) OR (e.state = ? AND e.region = ?)"
    assert params == ["IN", "Gary", "IN", "Midwest"]
    assert data_module._source_place_filter_clause([{"state": None}], []) is None  # noqa: SLF001


def test_place_resource_slug_state_and_city_helpers() -> None:
    assert data_module._place_resource_slug({"city": None, "state": "IN", "region": None}) == "in"  # noqa: SLF001
    assert (
        data_module._place_resource_uri({"city": None, "state": "IN", "region": None}, "profile")
        == "atlas://states/IN/profile"
    )
    assert (
        data_module._place_resource_uri({"city": "Gary", "state": "IN", "region": None}, "coverage")
        == "atlas://cities/gary-in/coverage"
    )


def test_normalize_place_key_supports_state_and_city_state() -> None:
    assert normalize_place_key("ut") == {
        "city": None,
        "state": "UT",
        "region": None,
        "display": "UT",
    }
    assert normalize_place_key("gary-in") == {
        "city": "Gary",
        "state": "IN",
        "region": None,
        "display": "Gary, IN",
    }


def test_normalize_state_and_place_helpers() -> None:
    assert data_module._normalize_state(None) is None  # noqa: SLF001
    assert data_module._normalize_state("   ") is None  # noqa: SLF001
    assert data_module._normalize_state("California") == "CA"  # noqa: SLF001
    assert data_module._normalize_state("ca") == "CA"  # noqa: SLF001
    assert data_module._normalize_state("Atlantis") is None  # noqa: SLF001


def test_validate_issue_areas_rejects_unknown_values() -> None:
    assert data_module._validate_issue_areas(None) == []  # noqa: SLF001
    assert data_module._validate_issue_areas(["housing_affordability"]) == ["housing_affordability"]  # noqa: SLF001
    with pytest.raises(ValueError, match="Invalid issue area"):
        data_module._validate_issue_areas(["not-a-real-issue"])  # noqa: SLF001


def test_tokenize_and_freshness_helpers() -> None:
    assert data_module._tokenize("Hello, World! 123") == ["hello", "world", "123"]  # noqa: SLF001
    status, reason = data_module._staleness(None, "entity data")  # noqa: SLF001
    assert status == "unknown"
    assert "No date" in reason
    today = datetime.now(UTC).date().isoformat()
    assert data_module._staleness(today, "entity data")[0] == "fresh"  # noqa: SLF001
    stale_target = (datetime.now(UTC).date() - timedelta(days=AGING_DAYS + 5)).isoformat()
    assert data_module._staleness(stale_target, "entity data")[0] == "stale"  # noqa: SLF001
    assert data_module._coerce_date("2026-04-30") == date(2026, 4, 30)  # noqa: SLF001
    assert data_module._string_or_none(42) == "42"  # noqa: SLF001


def test_latest_source_date_and_place_fallbacks() -> None:
    assert (
        data_module._latest_source_date(
            [{"published_date": "2026-01-15", "ingested_at": None}],
            "fallback",
        )
        == "2026-01-15"
    )  # noqa: SLF001
    assert (
        data_module._latest_source_date(
            [{"published_date": None, "ingested_at": "2026-02-20T12:34:56Z"}],
            "fallback",
        )
        == "2026-02-20"
    )  # noqa: SLF001
    assert data_module._latest_source_date([], "fallback-date") == "fallback-date"  # noqa: SLF001
