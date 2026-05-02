"""Tests for IRS nonprofit lookup functionality."""

from atlas.domains.access.irs_lookup import (
    is_valid_ein,
    lookup_nonprofit_budget,
    lookup_nonprofit_by_ein,
    normalize_ein,
)


class TestIRSLookup:
    """Test IRS nonprofit database lookups."""

    def test_valid_ein_format(self) -> None:
        """Test that valid EIN formats are recognized."""
        assert is_valid_ein("04-1798922")
        assert is_valid_ein("041798922")
        assert is_valid_ein("04-3948268")

    def test_invalid_ein_format(self) -> None:
        """Test that invalid EIN formats are rejected."""
        assert not is_valid_ein("123")
        assert not is_valid_ein("invalid")
        assert not is_valid_ein("")
        assert not is_valid_ein("12-345678a")

    def test_lookup_valid_nonprofit(self) -> None:
        """Test lookup of a known nonprofit (EFF)."""
        result = lookup_nonprofit_by_ein("04-1798922")
        assert result is not None
        assert result["ein"] == "04-1798922"
        assert "Electronic Frontier Foundation" in result.get("name", "")

    def test_lookup_nonexistent_nonprofit(self) -> None:
        """Test lookup of a nonexistent EIN."""
        result = lookup_nonprofit_by_ein("99-9999999")
        assert result is None

    def test_lookup_for_profit(self) -> None:
        """Test that for-profit companies are not returned."""
        # Using an EIN that belongs to a for-profit entity
        result = lookup_nonprofit_by_ein("06-1234567")
        # Should either be None or not marked as 501(c)(3)
        if result:
            assert result.get("tax_status") == "501(c)(3)"

    def test_ein_normalization(self) -> None:
        """Test that EINs with and without dashes are equivalent."""
        with_dash = lookup_nonprofit_by_ein("04-1798922")
        without_dash = lookup_nonprofit_by_ein("041798922")
        assert with_dash == without_dash

    def test_lookup_invalid_format_returns_none(self) -> None:
        """Invalid-format EINs short-circuit to None before consulting the database."""
        assert lookup_nonprofit_by_ein("not-an-ein") is None
        assert lookup_nonprofit_by_ein("12345") is None

    def test_normalize_ein_passes_through_invalid_input(self) -> None:
        """normalize_ein returns the input unchanged when length is not 9 digits."""
        assert normalize_ein("12345") == "12345"
        assert normalize_ein("garbage") == "garbage"

    def test_normalize_ein_formats_unhyphenated(self) -> None:
        assert normalize_ein("041798922") == "04-1798922"

    def test_lookup_nonprofit_budget_returns_none(self) -> None:
        """Budget lookup is not yet wired up; documented to return None."""
        assert lookup_nonprofit_budget("04-1798922") is None
