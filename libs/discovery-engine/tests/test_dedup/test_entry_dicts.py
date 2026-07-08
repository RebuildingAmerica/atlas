"""Tests for deduplicating entry dictionaries."""

from __future__ import annotations

from atlas_discovery_engine.dedup import DeduplicationFlag, DedupResult, deduplicate_entry_dicts

from .support import _entry


class TestDeduplicateEntryDicts:
    def test_empty_input_returns_empty_result(self) -> None:
        result = deduplicate_entry_dicts([])
        assert isinstance(result, DedupResult)
        assert result.entries == []
        assert result.merges == []
        assert result.flags == []

    def test_unique_entries_pass_through(self) -> None:
        result = deduplicate_entry_dicts(
            [
                _entry(name="Acme", city="Austin"),
                _entry(name="Globex", city="Dallas"),
            ]
        )
        assert len(result.entries) == 2
        assert result.merges == []

    def test_exact_duplicate_same_city_merges(self) -> None:
        result = deduplicate_entry_dicts(
            [
                _entry(name="Housing First", city="Austin"),
                _entry(name="housing first", city="Austin"),
            ]
        )
        assert len(result.entries) == 1
        assert result.merges == [[0, 1]]

    def test_exact_name_different_city_flags(self) -> None:
        result = deduplicate_entry_dicts(
            [
                _entry(name="Housing First Coalition", city="Austin"),
                _entry(name="Housing First Coalition", city="Boston"),
            ]
        )
        assert len(result.entries) == 2
        assert result.flags

    def test_organization_single_word_exact_name_merges_across_cities(self) -> None:
        result = deduplicate_entry_dicts(
            [
                _entry(name="Greenpeace", city="Austin", entry_type="organization"),
                _entry(name="greenpeace", city="Boston", entry_type="organization"),
            ]
        )
        assert len(result.entries) == 1

    def test_organization_multi_word_different_city_flags(self) -> None:
        result = deduplicate_entry_dicts(
            [
                _entry(name="Working Families Party", city="Austin", entry_type="organization"),
                _entry(name="Working Families Party", city="New York", entry_type="organization"),
            ]
        )
        assert len(result.entries) == 2
        assert result.flags

    def test_person_with_affiliation_merges(self) -> None:
        result = deduplicate_entry_dicts(
            [
                _entry(
                    name="Jane Doe",
                    city="Austin",
                    entry_type="person",
                    affiliated_org="Housing First",
                ),
                _entry(
                    name="jane doe",
                    city="Boston",
                    entry_type="person",
                    affiliated_org="housing first",
                ),
            ]
        )
        assert len(result.entries) == 1

    def test_person_high_similarity_same_city_with_affiliation_flags(self) -> None:
        result = deduplicate_entry_dicts(
            [
                _entry(
                    name="Jane Doe",
                    city="Austin",
                    entry_type="person",
                    affiliated_org="Housing First",
                ),
                _entry(
                    name="Jane Do",
                    city="Austin",
                    entry_type="person",
                    affiliated_org="Housing First",
                ),
            ]
        )
        assert result.entries
        assert any(isinstance(flag, DeduplicationFlag) for flag in result.flags)

    def test_high_similarity_same_city_flags_without_affiliation(self) -> None:
        result = deduplicate_entry_dicts(
            [
                _entry(name="Acme Corporation", city="Austin"),
                _entry(name="Acme Corporatio", city="Austin"),
            ]
        )
        assert result.flags
        assert all(0 <= flag.confidence <= 1 for flag in result.flags)

    def test_existing_entries_are_combined(self) -> None:
        result = deduplicate_entry_dicts(
            [_entry(name="Housing First", city="Austin")],
            existing=[_entry(name="Housing First", city="Austin")],
        )
        assert len(result.entries) == 1

    def test_merge_combines_descriptions_and_sources(self) -> None:
        result = deduplicate_entry_dicts(
            [
                _entry(
                    name="Housing First",
                    city="Austin",
                    description="Short.",
                    issue_areas=["housing_affordability"],
                    source_urls=["https://a.example"],
                    source_dates=["2024-01-01"],
                    source_contexts={"https://a.example": "context a"},
                    social_media={"twitter": "@hf"},
                    last_seen="2024-01-01",
                ),
                _entry(
                    name="Housing First",
                    city="Austin",
                    description="A longer canonical description that wins.",
                    issue_areas=["housing_supply"],
                    source_urls=["https://b.example"],
                    source_dates=["2024-06-01"],
                    source_contexts={"https://b.example": "context b"},
                    social_media={"linkedin": "hf"},
                    last_seen="2024-06-01",
                ),
            ]
        )
        merged = result.entries[0]
        assert merged["description"] == "A longer canonical description that wins."
        assert sorted(merged["issue_areas"]) == ["housing_affordability", "housing_supply"]
        assert sorted(merged["source_urls"]) == [
            "https://a.example",
            "https://b.example",
        ]
        assert merged["source_dates"] == ["2024-01-01", "2024-06-01"]
        assert merged["source_contexts"] == {
            "https://a.example": "context a",
            "https://b.example": "context b",
        }
        assert merged["last_seen"] == "2024-06-01"
        assert merged["social_media"] == {"twitter": "@hf", "linkedin": "hf"}

    def test_merge_falls_back_to_empty_description(self) -> None:
        result = deduplicate_entry_dicts(
            [
                _entry(name="Acme", city="Austin"),
                _entry(name="Acme", city="Austin"),
            ]
        )
        assert result.entries[0]["description"] == ""

    def test_merge_picks_up_optional_fields_from_right(self) -> None:
        result = deduplicate_entry_dicts(
            [
                _entry(name="Acme", city="Austin"),
                _entry(name="Acme", city="Austin", website="https://acme.org", email="hi@a.org"),
            ]
        )
        merged = result.entries[0]
        assert merged["website"] == "https://acme.org"
        assert merged["email"] == "hi@a.org"

    def test_merge_handles_none_social_media(self) -> None:
        result = deduplicate_entry_dicts(
            [
                _entry(name="Acme", city="Austin", social_media=None),
                _entry(name="Acme", city="Austin", social_media=None),
            ]
        )
        assert result.entries[0]["social_media"] is None

    def test_normalization_handles_missing_optional_fields(self) -> None:
        result = deduplicate_entry_dicts(
            [{"name": "Bare", "entry_type": "organization", "city": "Austin"}]
        )
        normalized = result.entries[0]
        assert normalized["issue_areas"] == []
        assert normalized["source_urls"] == []
        assert normalized["source_dates"] == []
        assert normalized["source_contexts"] == {}
        assert normalized["social_media"] is None
