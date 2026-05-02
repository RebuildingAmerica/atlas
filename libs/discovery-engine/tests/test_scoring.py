"""Tests for shared ranking primitives."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from atlas_shared import DeduplicatedEntry, RankedEntry

from atlas_discovery_engine.scoring import (
    ScoredRecord,
    score_ranked_records,
    score_ranked_stream,
)


def _today() -> datetime:
    return datetime.now(UTC)


def _days_ago(n: int) -> str:
    return (_today() - timedelta(days=n)).date().isoformat()


def _record(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "default-id",
        "name": "Default Org",
        "geo_specificity": "local",
        "website": "https://example.org",
        "email": "info@example.org",
        "social_media": {"twitter": "@org"},
        "description": " ".join(["word"] * 30),
        "issue_areas": ["a", "b", "c"],
        "source_urls": ["https://a", "https://b"],
        "source_dates": [_days_ago(15)],
        "last_seen": _days_ago(15),
    }
    base.update(overrides)
    return base


class TestScoreRankedRecords:
    def test_returns_records_sorted_by_score(self) -> None:
        weak = _record(
            id="weak",
            geo_specificity="national",
            website=None,
            email=None,
            social_media={},
            description="",
            issue_areas=[],
            source_urls=[],
            source_dates=[],
            last_seen=None,
        )
        strong = _record(id="strong")

        ranked = score_ranked_records([weak, strong])

        assert all(isinstance(r, ScoredRecord) for r in ranked)
        assert ranked[0].entry["id"] == "strong"
        assert ranked[0].score >= ranked[1].score

    def test_falls_back_to_name_for_id(self) -> None:
        record = _record()
        record.pop("id")
        ranked = score_ranked_records([record])
        assert ranked[0].entry["name"] == "Default Org"

    def test_uses_explicit_source_counts(self) -> None:
        record = _record(id="boosted", source_urls=[])
        ranked = score_ranked_records([record], source_counts={"boosted": 5})
        assert ranked[0].components["source_density"] == 5.0

    def test_caps_source_density_at_five(self) -> None:
        record = _record(id="many", source_urls=[f"https://{i}" for i in range(20)])
        ranked = score_ranked_records([record])
        assert ranked[0].components["source_density"] == 5.0

    def test_falls_back_to_source_dates_when_last_seen_missing(self) -> None:
        record = _record(
            last_seen=None,
            source_dates=[_days_ago(20), _days_ago(10), "not-a-date"],
        )
        ranked = score_ranked_records([record])
        assert ranked[0].components["recency"] == 1.0

    def test_recency_zero_when_no_dates(self) -> None:
        record = _record(last_seen=None, source_dates=[])
        ranked = score_ranked_records([record])
        assert ranked[0].components["recency"] == 0.0

    def test_recency_handles_datetime_value(self) -> None:
        record = _record(last_seen=_today() - timedelta(days=5))
        ranked = score_ranked_records([record])
        assert ranked[0].components["recency"] == 1.0

    def test_recency_handles_pure_date_value(self) -> None:
        record = _record(last_seen=(_today() - timedelta(days=5)).date())
        ranked = score_ranked_records([record])
        assert ranked[0].components["recency"] == 1.0

    def test_recency_handles_invalid_string(self) -> None:
        record = _record(last_seen="totally-not-a-date", source_dates=[])
        ranked = score_ranked_records([record])
        assert ranked[0].components["recency"] == 0.0

    def test_recency_handles_unsupported_type(self) -> None:
        record = _record(last_seen=12345, source_dates=[])
        ranked = score_ranked_records([record])
        assert ranked[0].components["recency"] == 0.0

    def test_recency_future_date_returns_one(self) -> None:
        future = (_today() + timedelta(days=10)).date().isoformat()
        record = _record(last_seen=future)
        ranked = score_ranked_records([record])
        assert ranked[0].components["recency"] == 1.0

    @pytest.mark.parametrize(
        "days_ago,expected",
        [
            (10, 1.0),
            (60, 0.75),
            (120, 0.5),
            (300, 0.25),
            (800, 0.1),
        ],
    )
    def test_recency_tiers(self, days_ago: int, expected: float) -> None:
        record = _record(last_seen=_days_ago(days_ago))
        ranked = score_ranked_records([record])
        assert ranked[0].components["recency"] == pytest.approx(expected)

    @pytest.mark.parametrize(
        "geo,expected",
        [
            ("local", 1.0),
            ("regional", 0.75),
            ("statewide", 0.5),
            ("national", 0.25),
            ("unknown", 0.0),
            ("", 0.0),
        ],
    )
    def test_geo_score(self, geo: str, expected: float) -> None:
        record = _record(geo_specificity=geo)
        ranked = score_ranked_records([record])
        assert ranked[0].components["geo_specificity"] == expected

    def test_contact_surface_no_contact(self) -> None:
        record = _record(website=None, email=None, social_media={})
        ranked = score_ranked_records([record])
        assert ranked[0].components["contact_surface"] == 0.0

    def test_contact_surface_website_only(self) -> None:
        record = _record(website="https://x", email=None, social_media={})
        ranked = score_ranked_records([record])
        assert ranked[0].components["contact_surface"] == pytest.approx(0.4)

    def test_contact_surface_email_only(self) -> None:
        record = _record(website=None, email="x@x.org", social_media={})
        ranked = score_ranked_records([record])
        assert ranked[0].components["contact_surface"] == pytest.approx(0.35)

    def test_contact_surface_social_only(self) -> None:
        record = _record(website=None, email=None, social_media={"twitter": "@x"})
        ranked = score_ranked_records([record])
        assert ranked[0].components["contact_surface"] == pytest.approx(0.25)

    def test_contact_surface_all_three_caps_at_one(self) -> None:
        record = _record()
        ranked = score_ranked_records([record])
        assert ranked[0].components["contact_surface"] == 1.0

    def test_description_quality_caps_at_one(self) -> None:
        record = _record(description=" ".join(["w"] * 100))
        ranked = score_ranked_records([record])
        assert ranked[0].components["description_quality"] == 1.0

    def test_description_quality_proportional(self) -> None:
        record = _record(description=" ".join(["w"] * 5))
        ranked = score_ranked_records([record])
        assert ranked[0].components["description_quality"] == pytest.approx(5 / 25.0)

    def test_handles_none_social_media(self) -> None:
        record = _record(social_media=None)
        ranked = score_ranked_records([record])
        assert ranked[0].components["contact_surface"] == pytest.approx(0.4 + 0.35)


class TestScoreRankedStream:
    @staticmethod
    async def _stream(items: list[DeduplicatedEntry]) -> AsyncIterator[DeduplicatedEntry]:
        for item in items:
            yield item

    @staticmethod
    def _entry(
        *,
        name: str = "Org",
        source_urls: list[str] | None = None,
        source_dates: list[Any] | None = None,
        last_seen: Any = None,
        social_media: dict[str, str] | None = None,
        website: str | None = "https://x",
        email: str | None = "x@x",
        issue_areas: list[str] | None = None,
        geo: str = "local",
        description: str = "Description for the entry.",
    ) -> DeduplicatedEntry:
        return DeduplicatedEntry(
            name=name,
            entry_type="organization",  # type: ignore[arg-type]
            description=description,
            city="Austin",
            state="TX",
            geo_specificity=geo,  # type: ignore[arg-type]
            issue_areas=issue_areas or ["a"],
            social_media=social_media or {},
            website=website,
            email=email,
            source_urls=source_urls or [],
            source_dates=source_dates or [],
            source_contexts={},
            last_seen=last_seen,
        )

    @pytest.mark.asyncio
    async def test_filters_below_min_score(self) -> None:
        weak = self._entry(
            name="weak",
            website=None,
            email=None,
            social_media={},
            issue_areas=[],
            description="",
            geo="national",
        )
        strong = self._entry(
            name="strong",
            source_urls=["https://a", "https://b", "https://c"],
            last_seen=_today().date(),
            social_media={"x": "y"},
        )

        results: list[RankedEntry] = []
        async for entry in score_ranked_stream(self._stream([weak, strong]), min_score=0.05):
            results.append(entry)

        names = [r.entry.name for r in results]
        assert "strong" in names
        assert "weak" not in names

    @pytest.mark.asyncio
    async def test_uses_source_dates_when_last_seen_none(self) -> None:
        entry = self._entry(
            name="dated",
            source_dates=[_today().date()],
            last_seen=None,
        )
        results: list[RankedEntry] = []
        async for ranked in score_ranked_stream(self._stream([entry])):
            results.append(ranked)

        assert results[0].components["recency"] == 1.0

    @pytest.mark.asyncio
    async def test_returns_sorted_descending(self) -> None:
        entries = [
            self._entry(
                name=f"e{i}",
                source_urls=[f"https://{i}"] * (i + 1),
                last_seen=_today().date(),
            )
            for i in range(3)
        ]
        results: list[RankedEntry] = []
        async for ranked in score_ranked_stream(self._stream(entries)):
            results.append(ranked)

        scores = [r.score for r in results]
        assert scores == sorted(scores, reverse=True)
