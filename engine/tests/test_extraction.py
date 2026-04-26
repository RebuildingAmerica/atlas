"""Tests for shared extraction primitives."""

from __future__ import annotations

import json

import pytest
from atlas_shared import PageContent, RawEntry

from atlas_discovery_engine.extraction import (
    ExtractionFailedError,
    build_extraction_system_prompt,
    build_identify_system_prompt,
    normalize_entity_type,
    normalize_geo_specificity,
    parse_extraction_response,
    parse_identify_response,
    strip_code_fence,
    validate_entries,
)


class TestStripCodeFence:
    def test_removes_json_fence(self) -> None:
        raw = '```json\n{"key": "value"}\n```'
        assert strip_code_fence(raw) == '{"key": "value"}'

    def test_removes_plain_fence(self) -> None:
        raw = "```\n[1, 2, 3]\n```"
        assert strip_code_fence(raw) == "[1, 2, 3]"

    def test_returns_unfenced_text_unchanged(self) -> None:
        raw = '{"key": "value"}'
        assert strip_code_fence(raw) == raw

    def test_handles_whitespace(self) -> None:
        raw = '  ```json\n{"a": 1}\n```  '
        assert strip_code_fence(raw) == '{"a": 1}'


class TestNormalization:
    def test_normalize_geo_known_values(self) -> None:
        assert normalize_geo_specificity("local") == "local"
        assert normalize_geo_specificity("city") == "local"
        assert normalize_geo_specificity("regional") == "regional"
        assert normalize_geo_specificity("metro") == "regional"
        assert normalize_geo_specificity("statewide") == "statewide"
        assert normalize_geo_specificity("state-level") == "statewide"
        assert normalize_geo_specificity("national") == "national"
        assert normalize_geo_specificity("federal") == "national"

    def test_normalize_geo_case_insensitive(self) -> None:
        assert normalize_geo_specificity("LOCAL") == "local"
        assert normalize_geo_specificity("National") == "national"

    def test_normalize_geo_unknown_defaults_to_local(self) -> None:
        assert normalize_geo_specificity("galactic") == "local"

    def test_normalize_type_known_values(self) -> None:
        assert normalize_entity_type("person") == "person"
        assert normalize_entity_type("individual") == "person"
        assert normalize_entity_type("organization") == "organization"
        assert normalize_entity_type("org") == "organization"
        assert normalize_entity_type("nonprofit") == "organization"
        assert normalize_entity_type("initiative") == "initiative"
        assert normalize_entity_type("program") == "initiative"
        assert normalize_entity_type("campaign") == "campaign"
        assert normalize_entity_type("movement") == "campaign"
        assert normalize_entity_type("event") == "event"
        assert normalize_entity_type("conference") == "event"

    def test_normalize_type_unknown_defaults_to_organization(self) -> None:
        assert normalize_entity_type("widget") == "organization"


class TestParseIdentifyResponse:
    def test_parses_valid_array(self) -> None:
        text = json.dumps([
            {"name": "Jane Doe", "type": "person", "quote": "Jane said..."},
            {"name": "Acme Corp", "type": "organization", "quote": "Acme builds..."},
        ])
        result = parse_identify_response(text)
        assert len(result) == 2
        assert result[0]["name"] == "Jane Doe"
        assert result[1]["type"] == "organization"

    def test_handles_fenced_json(self) -> None:
        text = '```json\n[{"name": "Test", "type": "org", "quote": "q"}]\n```'
        result = parse_identify_response(text)
        assert len(result) == 1

    def test_handles_think_tags(self) -> None:
        text = '<think>reasoning here</think>[{"name": "Test", "type": "org", "quote": "q"}]'
        result = parse_identify_response(text)
        assert len(result) == 1

    def test_returns_empty_on_invalid_json(self) -> None:
        assert parse_identify_response("not json at all") == []

    def test_returns_empty_on_non_array(self) -> None:
        assert parse_identify_response('{"key": "value"}') == []

    def test_skips_items_without_name(self) -> None:
        text = json.dumps([{"type": "org"}, {"name": "Valid", "type": "org"}])
        result = parse_identify_response(text)
        assert len(result) == 1
        assert result[0]["name"] == "Valid"

    def test_extracts_array_from_surrounding_text(self) -> None:
        text = 'Here are the results: [{"name": "Found", "type": "org", "quote": "q"}] end'
        result = parse_identify_response(text)
        assert len(result) == 1


class TestParseExtractionResponse:
    def test_parses_entries_envelope(self) -> None:
        payload = json.dumps({
            "entries": [{
                "name": "Test Org",
                "type": "organization",
                "description": "A test org.",
                "city": "Austin",
                "state": "TX",
                "geo_specificity": "local",
                "issue_areas": ["housing_affordability"],
                "extraction_context": "Test Org works on housing.",
            }],
            "discovery_leads": ["https://example.com"],
        })
        result = parse_extraction_response(text=payload)
        assert len(result) == 1
        assert result[0].name == "Test Org"
        assert result[0].entry_type == "organization"
        assert result[0].discovery_leads == ["https://example.com"]

    def test_parses_bare_array(self) -> None:
        payload = json.dumps([{
            "name": "Bare Entry",
            "type": "initiative",
            "description": "Desc.",
            "geo_specificity": "regional",
        }])
        result = parse_extraction_response(text=payload)
        assert len(result) == 1
        assert result[0].name == "Bare Entry"

    def test_accepts_parsed_dict(self) -> None:
        parsed = {
            "entries": [{
                "name": "Parsed Entry",
                "type": "person",
                "description": "From parsed.",
                "geo_specificity": "national",
            }],
        }
        result = parse_extraction_response(parsed=parsed)
        assert len(result) == 1
        assert result[0].entry_type == "person"

    def test_normalizes_geo_and_type_aliases(self) -> None:
        payload = json.dumps([{
            "name": "Alias Test",
            "type": "nonprofit",
            "description": "Testing aliases.",
            "geo_specificity": "city-level",
        }])
        result = parse_extraction_response(text=payload)
        assert result[0].entry_type == "organization"
        assert result[0].geo_specificity == "local"

    def test_handles_fenced_json(self) -> None:
        payload = '```json\n[{"name": "Fenced", "type": "org", "geo_specificity": "local"}]\n```'
        result = parse_extraction_response(text=payload)
        assert len(result) == 1

    def test_raises_on_invalid_json(self) -> None:
        with pytest.raises(ExtractionFailedError, match="invalid_json"):
            parse_extraction_response(text="not json")

    def test_returns_empty_when_both_none(self) -> None:
        assert parse_extraction_response() == []

    def test_raises_on_malformed_entries_list(self) -> None:
        payload = json.dumps({"entries": [
            {"name": "Good", "type": "org", "geo_specificity": "local"},
            "not a dict at all",
        ]})
        with pytest.raises(ExtractionFailedError, match="structured_output_validation_failed"):
            parse_extraction_response(text=payload)


class TestBuildPrompts:
    def test_extraction_prompt_includes_location(self) -> None:
        prompt = build_extraction_system_prompt("Austin", "TX")
        assert "Austin, TX" in prompt

    def test_extraction_prompt_includes_taxonomy(self) -> None:
        prompt = build_extraction_system_prompt("Austin", "TX")
        assert "housing_affordability" in prompt
        assert "worker_cooperatives" in prompt

    def test_extraction_prompt_includes_directive(self) -> None:
        prompt = build_extraction_system_prompt("Austin", "TX", extraction_directive="Focus on housing.")
        assert "Focus on housing." in prompt

    def test_extraction_prompt_without_location(self) -> None:
        prompt = build_extraction_system_prompt("", "")
        assert "No target location was provided" in prompt

    def test_identify_prompt_is_nonempty(self) -> None:
        prompt = build_identify_system_prompt()
        assert "JSON array" in prompt
        assert "name" in prompt


class TestValidateEntries:
    def _make_entry(self, name: str, context: str = "") -> RawEntry:
        return RawEntry(
            name=name,
            entry_type="organization",
            description="Test.",
            extraction_context=context,
        )

    def _make_page(self, text: str) -> PageContent:
        return PageContent(url="https://example.com/page", text=text)

    def test_keeps_grounded_entries(self) -> None:
        page = self._make_page("The Kansas City Housing Coalition launched a new program.")
        entry = self._make_entry(
            "Kansas City Housing Coalition",
            context="The Kansas City Housing Coalition launched a new program.",
        )
        result = validate_entries([entry], page)
        assert len(result) == 1

    def test_drops_hallucinated_entries(self) -> None:
        page = self._make_page("This article is about housing in Missouri.")
        entry = self._make_entry("Invented Organization Name", context="Made up quote.")
        result = validate_entries([entry], page)
        assert len(result) == 0

    def test_drops_no_proper_noun_signal(self) -> None:
        page = self._make_page("some generic text about housing things.")
        entry = self._make_entry("generic text", context="some generic text about housing things.")
        result = validate_entries([entry], page)
        assert len(result) == 0

    def test_keeps_entry_with_name_grounded_but_no_context(self) -> None:
        page = self._make_page("ACLU has been active in Kansas City.")
        entry = self._make_entry("ACLU", context="")
        result = validate_entries([entry], page)
        assert len(result) == 1

    def test_returns_empty_list_unchanged(self) -> None:
        page = self._make_page("anything")
        assert validate_entries([], page) == []

    def test_keeps_fuzzy_name_match(self) -> None:
        page = self._make_page(
            "Voices of Youth in Chicago Education (VOYCE) advocates for student rights."
        )
        entry = self._make_entry(
            "VOYCE",
            context="VOYCE advocates for student rights.",
        )
        result = validate_entries([entry], page)
        assert len(result) == 1
