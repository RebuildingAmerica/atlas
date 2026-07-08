"""Shared helpers for `atlas.platform.mcp.data` tests."""

from __future__ import annotations

from datetime import date

from atlas.domains.catalog.models.entry import EntryModel
from atlas.platform.mcp.data import AGING_DAYS, FRESHNESS_DAYS

__all__ = [
    "AGING_DAYS",
    "EXPECTED_DISTINCT_DOMAINS",
    "EXPECTED_THREE_SOURCES",
    "EXPECTED_TWO_CONTACT_SOURCES",
    "EXPECTED_TWO_RELATED_ENTITIES",
    "FRESHNESS_DAYS",
    "_build_entry",
]


EXPECTED_DISTINCT_DOMAINS = 2
EXPECTED_THREE_SOURCES = 3
EXPECTED_TWO_CONTACT_SOURCES = 2
EXPECTED_TWO_RELATED_ENTITIES = 2


def _build_entry(  # noqa: PLR0913
    *,
    entry_id: str = "entry-1",
    claim_status: str = "unclaimed",
    verified: bool = False,
    claimed_by_user_id: str | None = None,
    claim_verified_at: str | None = None,
    last_verified: date | None = None,
    last_confirmed_at: str | None = None,
    affiliated_org_id: str | None = None,
    suppressed_source_ids: list[str] | None = None,
) -> EntryModel:
    """Construct an EntryModel directly so tests can hit `_entity_record` helpers."""
    today = date.today()  # noqa: DTZ011
    return EntryModel(
        id=entry_id,
        type="organization",
        name="Helper Org",
        description="Helper org for unit branches.",
        city="Gary",
        state="IN",
        region=None,
        geo_specificity="local",
        latitude=None,
        longitude=None,
        geocode_precision=None,
        geocode_source=None,
        full_address=None,
        website=None,
        email=None,
        phone=None,
        social_media=None,
        affiliated_org_id=affiliated_org_id,
        active=True,
        verified=verified,
        last_verified=last_verified,
        contact_status="not_contacted",
        editorial_notes=None,
        priority=None,
        first_seen=today,
        last_seen=today,
        created_at="2026-01-01T00:00:00+00:00",
        updated_at="2026-01-02T00:00:00+00:00",
        slug="helper-org-aaaa",
        claim_status=claim_status,
        claimed_by_user_id=claimed_by_user_id,
        claim_verified_at=claim_verified_at,
        last_confirmed_at=last_confirmed_at,
        suppressed_source_ids=suppressed_source_ids or [],
    )
