"""Tests for pipeline location parsing."""

from atlas_scout.pipeline import _parse_location


def test_parse_location_city_state():
    city, state = _parse_location("Austin, TX")
    assert city == "Austin"
    assert state == "TX"


def test_parse_location_city_only():
    city, state = _parse_location("Austin")
    assert city == "Austin"
    assert state == ""


def test_parse_location_strips_whitespace():
    city, state = _parse_location("  Kansas City , MO  ")
    assert city == "Kansas City"
    assert state == "MO"


def test_parse_location_with_comma_in_state():
    # Only splits on first comma.
    city, state = _parse_location("St. Louis, MO")
    assert city == "St. Louis"
    assert state == "MO"
