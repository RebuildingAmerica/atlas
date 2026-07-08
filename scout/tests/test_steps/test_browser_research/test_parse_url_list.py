"""Tests for browser research URL parsing helpers."""

from __future__ import annotations

import json

from atlas_scout.steps import browser_research as br


def test_parse_url_list_returns_known_urls() -> None:
    valid = {"https://example.com/team", "https://example.com/about"}
    text = json.dumps(["https://example.com/team", "https://other.com/x"])
    result = br._parse_url_list(text, valid)
    assert result == ["https://example.com/team"]


def test_parse_url_list_handles_code_fence() -> None:
    valid = {"https://example.com/team"}
    text = '```json\n["https://example.com/team"]\n```'
    result = br._parse_url_list(text, valid)
    assert result == ["https://example.com/team"]


def test_parse_url_list_handles_think_tag() -> None:
    valid = {"https://example.com/team"}
    text = "<think>reasoning</think>\n" + json.dumps(["https://example.com/team"])
    result = br._parse_url_list(text, valid)
    assert result == ["https://example.com/team"]


def test_parse_url_list_invalid_json_returns_empty() -> None:
    assert br._parse_url_list("{not json", {"https://example.com/x"}) == []


def test_parse_url_list_non_array_returns_empty() -> None:
    text = json.dumps({"a": 1})
    assert br._parse_url_list(text, {"https://example.com/x"}) == []


def test_parse_url_list_filters_non_string_items() -> None:
    valid = {"https://example.com/x"}
    text = json.dumps(["https://example.com/x", 42, None])
    assert br._parse_url_list(text, valid) == ["https://example.com/x"]
