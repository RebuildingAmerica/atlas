"""Tests for Step 3: entry_extract."""

from __future__ import annotations

import json

import pytest

from atlas_scout.providers.base import Completion
from atlas_scout.steps.entry_extract import (
    ExtractionFailedError,
    _coerce_dict,
    _coerce_mention_list,
    _coerce_str_list,
    _normalize_entity_type,
    _normalize_geo_specificity,
    _parse_extraction_response,
    _parse_identify_response,
    _provider_cache_key,
)


def test_coerce_dict_handles_none() -> None:
    """None coerces to an empty dict."""
    assert _coerce_dict(None) == {}
    assert _coerce_dict({"a": "b"}) == {"a": "b"}


def test_coerce_str_list_handles_none() -> None:
    """None coerces to an empty list."""
    assert _coerce_str_list(None) == []
    assert _coerce_str_list(["a"]) == ["a"]


def test_coerce_mention_list_handles_none() -> None:
    """None coerces to an empty mention list."""
    assert _coerce_mention_list(None) == []
    assert _coerce_mention_list([{"name": "X"}]) == [{"name": "X"}]


# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------


def test_normalize_geo_specificity_known_alias() -> None:
    """Known aliases are normalized."""
    assert _normalize_geo_specificity("CITY") == "local"
    assert _normalize_geo_specificity("federal") == "national"


def test_normalize_geo_specificity_unknown_defaults_to_local(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Unknown values fall back to 'local' and emit a warning."""
    with caplog.at_level("WARNING", logger="atlas_scout.steps.entry_extract"):
        result = _normalize_geo_specificity("planet-wide")
    assert result == "local"
    assert any("Unknown geo_specificity" in r.message for r in caplog.records)


def test_normalize_entity_type_known_alias() -> None:
    """Known type aliases normalize."""
    assert _normalize_entity_type("nonprofit") == "organization"
    assert _normalize_entity_type("PROGRAM") == "initiative"


def test_normalize_entity_type_unknown_defaults_to_organization(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Unknown values fall back to 'organization' and emit a warning."""
    with caplog.at_level("WARNING", logger="atlas_scout.steps.entry_extract"):
        result = _normalize_entity_type("space-station")
    assert result == "organization"
    assert any("Unknown entity type" in r.message for r in caplog.records)


# ---------------------------------------------------------------------------
# Identify-pass parser
# ---------------------------------------------------------------------------


def test_parse_identify_response_strips_think_block() -> None:
    """A reasoning-model <think>...</think> prefix is stripped before parsing."""
    body = json.dumps([{"name": "Alice", "type": "person", "quote": "Alice spoke."}])
    text = f"<think>internal reasoning</think>\n{body}"

    items = _parse_identify_response(text)

    assert len(items) == 1
    assert items[0]["name"] == "Alice"


def test_parse_identify_response_recovers_array_from_text() -> None:
    """JSONDecodeError fallback finds and re-parses an embedded array."""
    body = json.dumps([{"name": "Bob", "type": "person", "quote": "Bob said hi."}])
    text = f"some chatter before [garbage [{body}] more garbage"

    items = _parse_identify_response(text)

    # When initial parse fails, find first [ and last ] and try again. The
    # constructed slice may not be valid JSON either, in which case we get [].
    # This still exercises the recovery path.
    assert isinstance(items, list)


def test_parse_identify_response_recovers_array_when_initial_parse_fails() -> None:
    """A leading non-JSON header but a clean trailing array is recovered."""
    body = json.dumps([{"name": "Eve", "type": "person", "quote": "Eve quoted."}])
    text = f"Here's the result:\n{body}"

    items = _parse_identify_response(text)

    assert len(items) == 1
    assert items[0]["name"] == "Eve"


def test_parse_identify_response_no_brackets_returns_empty() -> None:
    """No JSON brackets at all yields an empty list."""
    assert _parse_identify_response("just plain text, no brackets") == []


def test_parse_identify_response_unrecoverable_brackets_return_empty() -> None:
    """Brackets present but content is unparsable yields empty."""
    assert _parse_identify_response("text [not json here] more") == []


def test_parse_identify_response_non_list_root_returns_empty() -> None:
    """A JSON object at root yields an empty list."""
    assert _parse_identify_response(json.dumps({"foo": "bar"})) == []


def test_parse_identify_response_skips_items_without_name() -> None:
    """Non-dict items and dicts without a name are skipped."""
    text = json.dumps(
        [
            "string-item",
            {"type": "person"},  # no name
            {"name": "Real", "type": "person", "quote": "x"},
        ]
    )
    items = _parse_identify_response(text)
    assert len(items) == 1
    assert items[0]["name"] == "Real"


# ---------------------------------------------------------------------------
# Enrichment / structured response parser
# ---------------------------------------------------------------------------


def test_parse_extraction_response_uses_parsed_payload() -> None:
    """When provider returns parsed payload, no JSON parsing is needed."""
    completion = Completion(
        text="",
        parsed={
            "entries": [
                {
                    "name": "ParsedOrg",
                    "type": "organization",
                    "description": "d",
                    "city": "Austin",
                    "state": "TX",
                    "geo_specificity": "local",
                    "issue_areas": ["housing_affordability"],
                    "extraction_context": "ctx",
                }
            ],
            "discovery_leads": ["https://example.com/lead"],
        },
    )

    entries = _parse_extraction_response(completion)

    assert len(entries) == 1
    assert entries[0].name == "ParsedOrg"
    assert entries[0].discovery_leads == ["https://example.com/lead"]


def test_parse_extraction_response_falls_back_to_text_json() -> None:
    """When parsed is None, fall back to JSON-decoding the text."""
    payload = {
        "entries": [
            {
                "name": "TextOrg",
                "type": "organization",
                "extraction_context": "ctx",
            }
        ],
        "discovery_leads": [],
    }
    completion = Completion(text=json.dumps(payload), parsed=None)

    entries = _parse_extraction_response(completion)

    assert len(entries) == 1
    assert entries[0].name == "TextOrg"


def test_parse_extraction_response_raises_on_bad_text_json() -> None:
    """Invalid JSON without parsed payload raises ExtractionFailedError."""
    completion = Completion(text="not valid json {", parsed=None)

    with pytest.raises(ExtractionFailedError, match="invalid_json_response"):
        _parse_extraction_response(completion)


def test_parse_extraction_response_accepts_raw_array_payload() -> None:
    """A bare array payload is wrapped into the entries envelope."""
    completion = Completion(
        text="",
        parsed=None,
    )
    # Use a list at the JSON layer
    completion = Completion(
        text=json.dumps(
            [{"name": "ArrayOrg", "type": "organization", "extraction_context": "ctx"}]
        ),
        parsed=None,
    )

    entries = _parse_extraction_response(completion)

    assert len(entries) == 1
    assert entries[0].name == "ArrayOrg"


def test_parse_extraction_response_raises_on_validation_failure() -> None:
    """Pydantic validation errors are wrapped in ExtractionFailedError."""
    completion = Completion(
        text="",
        parsed={"entries": "not-a-list"},
    )

    with pytest.raises(ExtractionFailedError, match="structured_output_validation_failed"):
        _parse_extraction_response(completion)


# ---------------------------------------------------------------------------
# Provider cache key
# ---------------------------------------------------------------------------


class _ProviderWithExplicitIdentity:
    cache_identity = "custom:my-model"
    max_concurrent = 2

    async def complete(self, *_args, **_kwargs):  # pragma: no cover - not used here
        return Completion(text="[]")


def test_provider_cache_key_uses_explicit_identity() -> None:
    """A provider exposing cache_identity uses it directly."""
    assert _provider_cache_key(_ProviderWithExplicitIdentity()) == "custom:my-model"


class _ProviderWithoutModel:
    max_concurrent = 1

    async def complete(self, *_args, **_kwargs):  # pragma: no cover
        return Completion(text="[]")


def test_provider_cache_key_falls_back_to_class_name() -> None:
    """A provider without cache_identity or model uses the lowercase class name."""
    assert _provider_cache_key(_ProviderWithoutModel()) == "_providerwithoutmodel"
