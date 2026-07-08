"""Normalization and validation coverage for `atlas.platform.mcp.data`."""
# ruff: noqa

from __future__ import annotations

import pytest

from atlas.platform.mcp import data as data_module
from atlas.platform.mcp.data import normalize_place_key


class TestNormalizePlace:
    """`_normalize_place` should accept None, str, and Mapping shapes."""

    def test_none_returns_blank_address(self) -> None:
        assert data_module._normalize_place(None) == {  # noqa: SLF001
            "city": None,
            "state": None,
            "region": None,
            "display": None,
        }

    def test_two_letter_string_treated_as_state(self) -> None:
        result = data_module._normalize_place("ca")  # noqa: SLF001
        assert result == {"city": None, "state": "CA", "region": None, "display": "CA"}

    def test_city_state_string(self) -> None:
        result = data_module._normalize_place("Gary, Indiana")  # noqa: SLF001
        assert result == {
            "city": "Gary",
            "state": "IN",
            "region": None,
            "display": "Gary, IN",
        }

    def test_city_only_string(self) -> None:
        result = data_module._normalize_place("Gary")  # noqa: SLF001
        assert result["city"] == "Gary"
        assert result["state"] is None
        assert result["display"] == "Gary"

    def test_mapping_with_explicit_display(self) -> None:
        result = data_module._normalize_place(  # noqa: SLF001
            {"city": " Gary ", "state": "indiana", "region": "Lake", "display": "Custom"}
        )
        assert result == {
            "city": "Gary",
            "state": "IN",
            "region": "Lake",
            "display": "Custom",
        }

    def test_mapping_without_display_falls_back_to_format(self) -> None:
        result = data_module._normalize_place({"city": "Gary", "state": "IN"})  # noqa: SLF001
        assert result["display"] == "Gary, IN"

    def test_mapping_region_only(self) -> None:
        result = data_module._normalize_place({"region": "Northwest"})  # noqa: SLF001
        assert result == {
            "city": None,
            "state": None,
            "region": "Northwest",
            "display": "Northwest",
        }


class TestNormalizePlaceKey:
    def test_state_only_key(self) -> None:
        assert normalize_place_key("ut") == {
            "city": None,
            "state": "UT",
            "region": None,
            "display": "UT",
        }

    def test_city_state_key(self) -> None:
        assert normalize_place_key("gary-in") == {
            "city": "Gary",
            "state": "IN",
            "region": None,
            "display": "Gary, IN",
        }

    def test_unsupported_single_segment_raises(self) -> None:
        with pytest.raises(ValueError, match="Unsupported place key"):
            normalize_place_key("gary")


class TestNormalizeState:
    def test_none_returns_none(self) -> None:
        assert data_module._normalize_state(None) is None  # noqa: SLF001

    def test_blank_returns_none(self) -> None:
        assert data_module._normalize_state("   ") is None  # noqa: SLF001

    def test_full_name_resolves_to_code(self) -> None:
        assert data_module._normalize_state("California") == "CA"  # noqa: SLF001

    def test_two_letter_uppercases(self) -> None:
        assert data_module._normalize_state("ca") == "CA"  # noqa: SLF001

    def test_unknown_returns_none(self) -> None:
        # Only state names in `_STATE_NAMES` resolve; otherwise return None.
        assert data_module._normalize_state("Atlantis") is None  # noqa: SLF001


class TestValidateIssueAreas:
    def test_none_returns_empty_list(self) -> None:
        assert data_module._validate_issue_areas(None) == []  # noqa: SLF001

    def test_known_passes_through(self) -> None:
        assert data_module._validate_issue_areas(["housing_affordability"]) == [  # noqa: SLF001
            "housing_affordability"
        ]

    def test_invalid_raises(self) -> None:
        with pytest.raises(ValueError, match="Invalid issue area"):
            data_module._validate_issue_areas(["not-a-real-issue"])  # noqa: SLF001
