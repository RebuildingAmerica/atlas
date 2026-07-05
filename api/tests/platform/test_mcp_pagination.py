"""Tests for the shared MCP cursor pagination helpers."""

from __future__ import annotations

import pytest

from atlas.platform.mcp.pagination import decode_cursor, encode_cursor

EXPECTED_OFFSET = 5
EXPECTED_ROUND_TRIP_OFFSET = 42


class TestDecodeCursor:
    def test_none_returns_zero(self) -> None:
        assert decode_cursor(None) == 0

    def test_numeric_string_returns_offset(self) -> None:
        assert decode_cursor("5") == EXPECTED_OFFSET

    def test_zero_string_returns_zero(self) -> None:
        assert decode_cursor("0") == 0

    def test_negative_offset_raises(self) -> None:
        with pytest.raises(ValueError, match="Invalid cursor"):
            decode_cursor("-1")

    def test_non_numeric_raises(self) -> None:
        with pytest.raises(ValueError, match="Invalid cursor"):
            decode_cursor("not-a-number")


class TestEncodeCursor:
    def test_encodes_offset_as_string(self) -> None:
        assert encode_cursor(5) == "5"

    def test_round_trips_through_decode(self) -> None:
        assert decode_cursor(encode_cursor(42)) == EXPECTED_ROUND_TRIP_OFFSET
