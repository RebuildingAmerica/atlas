"""Discount verification API and data models."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Literal

from .irs_lookup import is_valid_ein, lookup_nonprofit_by_ein

# Constants for validation
MIN_MISSION_LENGTH = 20
MAX_NONPROFIT_BUDGET = 2_000_000
EIN_LENGTH = 9


class VerificationStatus(StrEnum):
    """Status of a discount verification."""

    PENDING = "pending"
    VERIFIED = "verified"
    REJECTED = "rejected"
    EXPIRED = "expired"


class VerificationMethod(StrEnum):
    """Method used to verify a discount claim."""

    PORTFOLIO = "portfolio"
    IRS_LOOKUP = "irs_lookup"
    SELF_ATTESTATION = "self_attestation"


@dataclass
class VerificationRequest:
    """Request to verify a discount claim."""

    segment: Literal["independent_journalist", "grassroots_nonprofit", "civic_tech_worker"]
    user_id: str
    data: dict[str, str]  # Segment-specific data (portfolio_url, ein, etc.)
    submitted_at: datetime


@dataclass
class VerificationRecord:
    """Record of a verified (or pending) discount claim."""

    user_id: str
    segment: Literal["independent_journalist", "grassroots_nonprofit", "civic_tech_worker"]
    status: VerificationStatus
    method: VerificationMethod
    submitted_at: datetime
    verified_at: datetime | None = None
    verification_data: dict[str, str] | None = None
    notes: str | None = None


class DiscountVerifier:
    """Handles verification of discount claims."""

    def verify_independent_journalist(self, portfolio_url: str) -> tuple[bool, str | None]:
        """
        Verify an independent journalist claim.

        For launch, this is manual review (returns pending).
        In production, could use URL/portfolio checking.

        Args:
            portfolio_url: URL to journalist's portfolio or byline

        Returns:
            (is_valid, error_message) tuple. If valid, error_message is None.
        """
        if not portfolio_url or not portfolio_url.strip():
            return False, "Portfolio URL is required"

        # Basic URL validation
        if not portfolio_url.startswith(("http://", "https://")):
            return False, "Portfolio URL must be a valid HTTP(S) URL"

        # For launch: accept valid URLs, mark as pending for manual review
        return True, None

    def verify_grassroots_nonprofit(self, ein_or_name: str, budget: str) -> tuple[bool, str | None]:  # noqa: PLR0911
        """
        Verify a grassroots nonprofit claim.

        Checks EIN against IRS database if provided, validates budget < $2M.

        Args:
            ein_or_name: EIN (XX-XXXXXXX format) or organization name
            budget: Annual budget as string (e.g., "$500,000")

        Returns:
            (is_valid, error_message) tuple. If valid, error_message is None.
        """
        if not ein_or_name or not ein_or_name.strip():
            return False, "Organization name or EIN is required"

        if not budget or not budget.strip():
            return False, "Annual budget is required"

        # Try to parse as EIN if it looks like one
        if "-" in ein_or_name or ein_or_name.replace(" ", "").isdigit():
            if is_valid_ein(ein_or_name):
                # Look up in IRS database
                nonprofit = lookup_nonprofit_by_ein(ein_or_name)
                if not nonprofit:
                    return False, "EIN not found in IRS database"
                # TODO: Check Form 990 data for budget
            else:
                return False, "Invalid EIN format (expected XX-XXXXXXX)"

        # Parse budget
        try:
            budget_str = budget.replace("$", "").replace(",", "").strip()
            budget_amount = float(budget_str)
        except ValueError:
            return False, "Budget must be a valid number"

        if budget_amount >= MAX_NONPROFIT_BUDGET:
            return False, "Budget must be under $2,000,000"

        return True, None

    def verify_civic_tech_worker(self, project_url: str, mission: str) -> tuple[bool, str | None]:
        """
        Verify a civic tech worker claim.

        Validates project URL and mission statement length.

        Args:
            project_url: URL to GitHub repo or project website
            mission: Mission statement (min 20 chars)

        Returns:
            (is_valid, error_message) tuple. If valid, error_message is None.
        """
        if not project_url or not project_url.strip():
            return False, "Project URL is required"

        if not mission or not mission.strip():
            return False, "Mission statement is required"

        # Validate URL
        if not project_url.startswith(("http://", "https://")):
            return False, "Project URL must be a valid HTTP(S) URL"

        # Validate mission length
        if len(mission) < MIN_MISSION_LENGTH:
            return False, "Mission statement should be at least 20 characters"

        return True, None

    def create_verification_request(
        self,
        segment: Literal["independent_journalist", "grassroots_nonprofit", "civic_tech_worker"],
        user_id: str,
        data: dict[str, str],
    ) -> VerificationRequest:
        """Create a new verification request."""
        return VerificationRequest(
            segment=segment,
            user_id=user_id,
            data=data,
            submitted_at=datetime.now(tz=UTC),
        )

    def create_verification_record(  # noqa: PLR0913
        self,
        user_id: str,
        segment: Literal["independent_journalist", "grassroots_nonprofit", "civic_tech_worker"],
        method: VerificationMethod,
        status: VerificationStatus = VerificationStatus.PENDING,
        verification_data: dict[str, str] | None = None,
        notes: str | None = None,
    ) -> VerificationRecord:
        """Create a verification record."""
        return VerificationRecord(
            user_id=user_id,
            segment=segment,
            status=status,
            method=method,
            submitted_at=datetime.now(tz=UTC),
            verification_data=verification_data,
            notes=notes,
        )

    def mark_verified(
        self, record: VerificationRecord, notes: str | None = None
    ) -> VerificationRecord:
        """Mark a verification record as verified."""
        record.status = VerificationStatus.VERIFIED
        record.verified_at = datetime.now(tz=UTC)
        if notes:
            record.notes = notes
        return record

    def mark_rejected(self, record: VerificationRecord, reason: str) -> VerificationRecord:
        """Mark a verification record as rejected."""
        record.status = VerificationStatus.REJECTED
        record.notes = reason
        return record

    def mark_expired(self, record: VerificationRecord) -> VerificationRecord:
        """Mark a verification record as expired."""
        record.status = VerificationStatus.EXPIRED
        return record

    def is_verification_expired(self, verified_at: datetime, days: int = 365) -> bool:
        """Check if a verification has expired (older than specified days)."""
        expiry_date = verified_at + timedelta(days=days)
        return datetime.now(tz=UTC) > expiry_date
