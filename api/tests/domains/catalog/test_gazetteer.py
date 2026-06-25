"""Tests for the offline city / state centroid gazetteer."""

from __future__ import annotations

from atlas.domains.catalog.geo.gazetteer import (
    Centroid,
    _load_city_index,
    lookup_centroid,
    lookup_state_centroid,
    normalize_city,
    normalize_state,
)

# Kansas City, MO centroid as bundled in the curated gazetteer.
_KANSAS_CITY_LAT = 39.1
_KANSAS_CITY_LNG = -94.58


class TestNormalizeState:
    """State codes should normalize to upper-case, stripped values."""

    def test_uppercases_and_strips(self) -> None:
        assert normalize_state("  mo ") == "MO"

    def test_already_canonical(self) -> None:
        assert normalize_state("TX") == "TX"


class TestNormalizeCity:
    """City names should normalize so spelling variants collide on one key."""

    def test_lowercases_and_collapses_whitespace(self) -> None:
        assert normalize_city("  Kansas   City ") == "kansas city"

    def test_saint_prefix_canonicalizes_to_saint(self) -> None:
        assert normalize_city("St. Louis") == "saint louis"
        assert normalize_city("Saint Louis") == "saint louis"

    def test_drops_periods(self) -> None:
        assert normalize_city("St. Paul") == normalize_city("Saint Paul")

    def test_non_saint_token_is_unchanged(self) -> None:
        # A bare "st" only canonicalizes as a standalone token, not a substring.
        assert normalize_city("Stockton") == "stockton"


class TestLookupCentroid:
    """City-centroid lookups should hit on known places and miss otherwise."""

    def test_known_city_hits(self) -> None:
        result = lookup_centroid("Kansas City", "MO")
        assert result is not None
        assert isinstance(result, Centroid)
        assert result.latitude == _KANSAS_CITY_LAT
        assert result.longitude == _KANSAS_CITY_LNG

    def test_spelling_variants_resolve_to_same_centroid(self) -> None:
        dotted = lookup_centroid("St. Louis", "MO")
        spelled = lookup_centroid("Saint Louis", "MO")
        assert dotted is not None
        assert dotted == spelled

    def test_case_and_whitespace_insensitive(self) -> None:
        result = lookup_centroid("  kansas city ", "mo")
        assert result is not None
        assert result.latitude == _KANSAS_CITY_LAT

    def test_unknown_city_misses(self) -> None:
        assert lookup_centroid("Nowheresville", "MO") is None

    def test_missing_city_returns_none(self) -> None:
        assert lookup_centroid(None, "MO") is None

    def test_missing_state_returns_none(self) -> None:
        assert lookup_centroid("Kansas City", None) is None

    def test_empty_city_returns_none(self) -> None:
        assert lookup_centroid("", "MO") is None


class TestLookupStateCentroid:
    """State-centroid lookups back-stop city misses."""

    def test_known_state_hits(self) -> None:
        result = lookup_state_centroid("MO")
        assert result is not None
        assert isinstance(result, Centroid)

    def test_case_insensitive(self) -> None:
        assert lookup_state_centroid("mo") == lookup_state_centroid("MO")

    def test_dc_is_included(self) -> None:
        assert lookup_state_centroid("DC") is not None

    def test_none_returns_none(self) -> None:
        assert lookup_state_centroid(None) is None

    def test_empty_returns_none(self) -> None:
        assert lookup_state_centroid("") is None

    def test_unknown_state_misses(self) -> None:
        assert lookup_state_centroid("ZZ") is None


class TestLoadCityIndex:
    """The bundled CSV should load into a normalized, cached index."""

    def test_index_is_nonempty_and_keyed_normally(self) -> None:
        index = _load_city_index()
        assert index
        assert ("kansas city", "MO") in index

    def test_index_is_cached(self) -> None:
        assert _load_city_index() is _load_city_index()
