"""Tests for raw entry stream deduplication."""

from __future__ import annotations

from collections.abc import AsyncIterator

from atlas_shared import RawEntry

from atlas_discovery_engine.dedup import deduplicate_raw_entries_stream


class TestDeduplicateRawEntriesStream:
    @staticmethod
    async def _stream(items: list[RawEntry]) -> AsyncIterator[RawEntry]:
        for item in items:
            yield item

    @staticmethod
    def _raw(
        *,
        name: str,
        city: str | None = "Austin",
        entry_type: str = "organization",
        affiliated_org: str | None = None,
        description: str = "",
        issue_areas: list[str] | None = None,
        source_url: str = "",
        source_context: str | None = None,
        source_date: str | None = None,
    ) -> RawEntry:
        return RawEntry(
            name=name,
            city=city,
            entry_type=entry_type,
            affiliated_org=affiliated_org,
            description=description,
            issue_areas=issue_areas or [],
            source_url=source_url,
            source_context=source_context,
            source_date=source_date,
        )

    async def test_stream_merges_as_items_arrive(self) -> None:
        stream = self._stream(
            [
                self._raw(
                    name="Housing First",
                    city="Austin",
                    issue_areas=["housing_affordability"],
                    source_url="https://a.example",
                ),
                self._raw(
                    name="housing first",
                    city="Austin",
                    issue_areas=["housing_supply"],
                    source_url="https://b.example",
                ),
            ]
        )
        result = [item async for item in deduplicate_raw_entries_stream(stream)]
        assert len(result) == 1
        assert result[0].name == "Housing First"
        assert sorted(result[0].issue_areas) == ["housing_affordability", "housing_supply"]

    async def test_stream_flushes_full_batches_and_merges_affiliated_people(self) -> None:
        stream = self._stream(
            [
                self._raw(
                    name="Jane Doe",
                    city="Austin",
                    entry_type="person",
                    affiliated_org="Housing First",
                    source_url="https://a.example",
                ),
                self._raw(
                    name="jane doe",
                    city="Boston",
                    entry_type="person",
                    affiliated_org="housing first",
                    source_url="https://b.example",
                ),
            ]
        )
        result = [item async for item in deduplicate_raw_entries_stream(stream, batch_size=1)]
        assert len(result) == 1
        assert result[0].name == "Jane Doe"
        assert result[0].source_urls == ["https://a.example", "https://b.example"]

    async def test_stream_keeps_entries_without_city(self) -> None:
        stream = self._stream([self._raw(name="Mutual Aid Network", city=None)])
        result = [item async for item in deduplicate_raw_entries_stream(stream)]
        assert len(result) == 1
        assert result[0].name == "Mutual Aid Network"
        assert result[0].city is None

    async def test_stream_yields_distinct_entries_when_not_merging(self) -> None:
        stream = self._stream(
            [
                self._raw(name="Alpha", city="Austin"),
                self._raw(name="Beta", city="Dallas"),
            ]
        )
        result = [item async for item in deduplicate_raw_entries_stream(stream)]
        assert [item.name for item in result] == ["Alpha", "Beta"]

    async def test_stream_accepts_empty_input(self) -> None:
        result = [item async for item in deduplicate_raw_entries_stream(self._stream([]))]
        assert result == []
