"""IRS nonprofit database lookup functionality."""

import re
from typing import TypedDict

# Constants
EIN_LENGTH = 9


class NonprofitRecord(TypedDict):
    """Record of a nonprofit from the IRS database."""

    ein: str
    name: str
    tax_status: str  # e.g., "501(c)(3)"
    state: str


# Minimal nonprofit database for initial launch.
# In production, this would be populated from the IRS Tax Exempt Organization Search
# (https://www.irs.gov/charities-non-profits/form-990-series-downloads)
_NONPROFIT_DATABASE: dict[str, NonprofitRecord] = {
    "04-1798922": {
        "ein": "04-1798922",
        "name": "Electronic Frontier Foundation",
        "tax_status": "501(c)(3)",
        "state": "CA",
    },
    "04-3948268": {
        "ein": "04-3948268",
        "name": "American Civil Liberties Union",
        "tax_status": "501(c)(3)",
        "state": "NY",
    },
    "13-1685379": {
        "ein": "13-1685379",
        "name": "The Wikimedia Foundation",
        "tax_status": "501(c)(3)",
        "state": "CA",
    },
    "13-4147222": {
        "ein": "13-4147222",
        "name": "Mozilla Foundation",
        "tax_status": "501(c)(3)",
        "state": "CA",
    },
}


def is_valid_ein(ein: str) -> bool:
    """
    Validate that an EIN has the correct format.

    EINs should be 9 digits, optionally with a dash after the first 2 digits.
    """
    # Normalize: remove dashes
    normalized = ein.replace("-", "")

    # Check format: exactly 9 digits
    return bool(re.match(rf"^\d{{{EIN_LENGTH}}}$", normalized))


def normalize_ein(ein: str) -> str:
    """Normalize an EIN to XX-XXXXXXX format."""
    normalized = ein.replace("-", "")
    if len(normalized) == EIN_LENGTH:
        return f"{normalized[:2]}-{normalized[2:]}"
    return ein


def lookup_nonprofit_by_ein(ein: str) -> NonprofitRecord | None:
    """
    Look up a nonprofit by EIN.

    Args:
        ein: The EIN to look up (with or without dashes)

    Returns:
        The nonprofit record if found, None otherwise
    """
    if not is_valid_ein(ein):
        return None

    # Normalize to XX-XXXXXXX format for lookup
    normalized = normalize_ein(ein)

    # Check the database
    return _NONPROFIT_DATABASE.get(normalized)


def lookup_nonprofit_budget(_ein: str) -> float | None:
    """
    Look up the annual budget of a nonprofit.

    In a production system, this would query the IRS Form 990 database.
    For now, returns None (budget verification would be manual).
    """
    # TODO: Integrate with IRS Form 990 data when available
    return None
