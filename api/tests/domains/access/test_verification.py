"""Tests for discount verification API."""

from datetime import UTC, datetime, timedelta

import pytest

from atlas.domains.access.verification import (
    DiscountVerifier,
    VerificationMethod,
    VerificationStatus,
)


@pytest.fixture
def verifier() -> DiscountVerifier:
    """Create a verifier instance for testing."""
    return DiscountVerifier()


class TestIndependentJournalistVerification:
    """Test independent journalist verification (format validation only)."""

    def test_valid_portfolio_url(self, verifier: DiscountVerifier) -> None:
        """Test that valid portfolio URLs are accepted for manual review."""
        is_valid, error = verifier.verify_independent_journalist("https://example.com/portfolio")
        assert is_valid
        assert error is None

    def test_missing_portfolio_url(self, verifier: DiscountVerifier) -> None:
        """Test that missing portfolio URL is rejected."""
        is_valid, error = verifier.verify_independent_journalist("")
        assert not is_valid
        assert error == "Portfolio URL is required"

    def test_invalid_portfolio_url(self, verifier: DiscountVerifier) -> None:
        """Test that non-HTTP URLs are rejected."""
        is_valid, error = verifier.verify_independent_journalist("not-a-url")
        assert not is_valid
        assert "valid HTTP(S) URL" in error


class TestGrassrootsNonprofitVerification:
    """Test grassroots nonprofit verification (format validation + manual review)."""

    def test_valid_ein_and_budget(self, verifier: DiscountVerifier) -> None:
        """Test verification with valid EIN format and budget."""
        is_valid, error = verifier.verify_grassroots_nonprofit("04-1798922", "$500,000")
        assert is_valid
        assert error is None

    def test_missing_ein(self, verifier: DiscountVerifier) -> None:
        """Test that missing EIN is rejected."""
        is_valid, _error = verifier.verify_grassroots_nonprofit("", "$500,000")
        assert not is_valid

    def test_missing_budget(self, verifier: DiscountVerifier) -> None:
        """Test that missing budget is rejected."""
        is_valid, _error = verifier.verify_grassroots_nonprofit("04-1798922", "")
        assert not is_valid

    def test_budget_too_high(self, verifier: DiscountVerifier) -> None:
        """Test that budget >= $2M is rejected."""
        is_valid, error = verifier.verify_grassroots_nonprofit("04-1798922", "$2,500,000")
        assert not is_valid
        assert "under $2,000,000" in error

    def test_budget_parsing(self, verifier: DiscountVerifier) -> None:
        """Test various budget formats."""
        # With commas
        is_valid, _ = verifier.verify_grassroots_nonprofit("04-1798922", "$1,500,000")
        assert is_valid

        # Without dollar sign
        is_valid, _ = verifier.verify_grassroots_nonprofit("04-1798922", "1500000")
        assert is_valid

    def test_invalid_ein_format(self, verifier: DiscountVerifier) -> None:
        """Test that invalid EIN format is rejected."""
        is_valid, _error = verifier.verify_grassroots_nonprofit("123", "$500,000")
        assert not is_valid

    def test_ein_normalization(self, verifier: DiscountVerifier) -> None:
        """Test that EINs with and without dashes both validate."""
        is_valid_dash, _ = verifier.verify_grassroots_nonprofit("04-1798922", "$500,000")
        is_valid_no_dash, _ = verifier.verify_grassroots_nonprofit("041798922", "$500,000")
        assert is_valid_dash
        assert is_valid_no_dash


class TestCivicTechVerification:
    """Test civic tech worker verification (format validation only)."""

    def test_valid_project_url_and_mission(self, verifier: DiscountVerifier) -> None:
        """Test verification with valid project URL and mission."""
        is_valid, error = verifier.verify_civic_tech_worker(
            "https://github.com/example/civic-tool",
            "Building tools to help citizens understand local government budgets",
        )
        assert is_valid
        assert error is None

    def test_missing_project_url(self, verifier: DiscountVerifier) -> None:
        """Test that missing project URL is rejected."""
        is_valid, _error = verifier.verify_civic_tech_worker("", "Building civic engagement tools")
        assert not is_valid

    def test_missing_mission(self, verifier: DiscountVerifier) -> None:
        """Test that missing mission is rejected."""
        is_valid, _error = verifier.verify_civic_tech_worker(
            "https://github.com/example/civic-tool", ""
        )
        assert not is_valid

    def test_mission_too_short(self, verifier: DiscountVerifier) -> None:
        """Test that mission < 20 chars is rejected."""
        is_valid, error = verifier.verify_civic_tech_worker(
            "https://github.com/example/civic-tool", "Too short"
        )
        assert not is_valid
        assert "at least 20 characters" in error

    def test_invalid_project_url(self, verifier: DiscountVerifier) -> None:
        """Test that non-HTTP URLs are rejected."""
        is_valid, _error = verifier.verify_civic_tech_worker(
            "not-a-url", "Building civic engagement tools that help communities"
        )
        assert not is_valid


class TestVerificationRecord:
    """Test verification record creation and status updates."""

    def test_create_verification_request(self, verifier: DiscountVerifier) -> None:
        """Test creating a verification request."""
        req = verifier.create_verification_request(
            "independent_journalist",
            "user123",
            {"portfolio_url": "https://example.com"},
        )
        assert req.user_id == "user123"
        assert req.segment == "independent_journalist"
        assert req.data["portfolio_url"] == "https://example.com"

    def test_create_verification_record(self, verifier: DiscountVerifier) -> None:
        """Test creating a verification record (starts as PENDING)."""
        record = verifier.create_verification_record(
            "user123",
            "grassroots_nonprofit",
            VerificationMethod.EIN_SUBMISSION,
            VerificationStatus.PENDING,
        )
        assert record.user_id == "user123"
        assert record.status == VerificationStatus.PENDING
        assert record.method == VerificationMethod.EIN_SUBMISSION
        assert "manual" in record.notes.lower()

    def test_mark_verified(self, verifier: DiscountVerifier) -> None:
        """Test marking a record as verified (after manual review)."""
        record = verifier.create_verification_record(
            "user123",
            "civic_tech_worker",
            VerificationMethod.MISSION_STATEMENT,
        )
        assert record.status == VerificationStatus.PENDING
        assert record.verified_at is None

        record = verifier.mark_verified(record, notes="Approved by reviewer")
        assert record.status == VerificationStatus.VERIFIED
        assert record.verified_at is not None
        assert record.notes == "Approved by reviewer"

    def test_mark_rejected(self, verifier: DiscountVerifier) -> None:
        """Test marking a record as rejected."""
        record = verifier.create_verification_record(
            "user123",
            "independent_journalist",
            VerificationMethod.PORTFOLIO,
        )
        record = verifier.mark_rejected(record, "Portfolio does not show journalism")
        assert record.status == VerificationStatus.REJECTED
        assert record.notes == "Portfolio does not show journalism"

    def test_is_verification_expired(self, verifier: DiscountVerifier) -> None:
        """Test checking if verification is expired."""
        old_date = datetime.now(tz=UTC) - timedelta(days=400)
        recent_date = datetime.now(tz=UTC) - timedelta(days=10)

        assert verifier.is_verification_expired(old_date, days=365)
        assert not verifier.is_verification_expired(recent_date, days=365)
