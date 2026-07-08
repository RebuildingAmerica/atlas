"""Formatting, freshness, and URI helper coverage for `atlas.platform.mcp.data`."""
# ruff: noqa

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

from atlas.platform.mcp import data as data_module

from tests.platform.mcp_data_support import (
    AGING_DAYS,
    FRESHNESS_DAYS,
    _build_entry,
)


class TestTokenize:
    def test_strips_punctuation_and_lowercases(self) -> None:
        assert data_module._tokenize("Hello, World! 123") == ["hello", "world", "123"]  # noqa: SLF001


class TestStaleness:
    def test_unknown_when_no_reference(self) -> None:
        status, reason = data_module._staleness(None, "entity data")  # noqa: SLF001
        assert status == "unknown"
        assert "No date" in reason

    def test_fresh_within_window(self) -> None:
        today = datetime.now(UTC).date().isoformat()
        status, _ = data_module._staleness(today, "entity data")  # noqa: SLF001
        assert status == "fresh"

    def test_aging_when_past_freshness(self) -> None:
        target = (datetime.now(UTC).date() - timedelta(days=FRESHNESS_DAYS + 5)).isoformat()
        status, _ = data_module._staleness(target, "entity data")  # noqa: SLF001
        assert status == "aging"

    def test_stale_when_past_aging(self) -> None:
        target = (datetime.now(UTC).date() - timedelta(days=AGING_DAYS + 5)).isoformat()
        status, _ = data_module._staleness(target, "entity data")  # noqa: SLF001
        assert status == "stale"

    def test_invalid_string_returns_unknown(self) -> None:
        status, reason = data_module._staleness("not-a-date", "entity data")  # noqa: SLF001
        assert status == "unknown"
        assert "No date" in reason


class TestCoerceDate:
    def test_none(self) -> None:
        assert data_module._coerce_date(None) is None  # noqa: SLF001

    def test_invalid(self) -> None:
        assert data_module._coerce_date("not-a-date") is None  # noqa: SLF001

    def test_iso(self) -> None:
        assert data_module._coerce_date("2026-04-30") == date(2026, 4, 30)  # noqa: SLF001


class TestStringOrNone:
    def test_none_passthrough(self) -> None:
        assert data_module._string_or_none(None) is None  # noqa: SLF001

    def test_int_to_str(self) -> None:
        assert data_module._string_or_none(42) == "42"  # noqa: SLF001


class TestFormatPlace:
    def test_city_state(self) -> None:
        assert data_module._format_place("Gary", "IN", None) == "Gary, IN"  # noqa: SLF001

    def test_city_only(self) -> None:
        assert data_module._format_place("Gary", None, None) == "Gary"  # noqa: SLF001

    def test_region_only(self) -> None:
        assert data_module._format_place(None, None, "Northwest") == "Northwest"  # noqa: SLF001

    def test_state_only(self) -> None:
        assert data_module._format_place(None, "IN", None) == "IN"  # noqa: SLF001

    def test_all_none_returns_none(self) -> None:
        assert data_module._format_place(None, None, None) is None  # noqa: SLF001


class TestPlaceResourceUri:
    def test_state_only_uri(self) -> None:
        assert (
            data_module._place_resource_uri({"city": None, "state": "IN"}, "profile")  # noqa: SLF001
            == "atlas://states/IN/profile"
        )

    def test_city_state_uri(self) -> None:
        uri = data_module._place_resource_uri(  # noqa: SLF001
            {"city": "Gary", "state": "IN", "region": None}, "coverage"
        )
        assert uri == "atlas://cities/gary-in/coverage"


class TestRelationshipIds:
    def test_includes_affiliate_when_present(self) -> None:
        entry = _build_entry(affiliated_org_id="org-2")
        ids = data_module._relationship_ids("entity-1", entry, ["housing_affordability"])  # noqa: SLF001
        assert any("affiliated_organization" in rid for rid in ids)
        assert any("shared_issue_area" in rid for rid in ids)

    def test_no_affiliate_means_no_affiliate_uri(self) -> None:
        entry = _build_entry(affiliated_org_id=None)
        ids = data_module._relationship_ids("entity-1", entry, [])  # noqa: SLF001
        assert ids == []


class TestLatestSourceDate:
    def test_returns_published_date_when_present(self) -> None:
        sources = [{"published_date": "2026-01-15", "ingested_at": None}]
        assert data_module._latest_source_date(sources, "fallback") == "2026-01-15"  # noqa: SLF001

    def test_falls_back_to_ingested_at(self) -> None:
        sources = [{"published_date": None, "ingested_at": "2026-02-20T12:34:56Z"}]
        assert data_module._latest_source_date(sources, "fallback") == "2026-02-20"  # noqa: SLF001

    def test_returns_fallback_when_nothing(self) -> None:
        assert data_module._latest_source_date([], "fallback-date") == "fallback-date"  # noqa: SLF001

    def test_skips_when_neither_field(self) -> None:
        sources = [{"published_date": None, "ingested_at": None}]
        assert data_module._latest_source_date(sources, "fallback-date") == "fallback-date"  # noqa: SLF001
