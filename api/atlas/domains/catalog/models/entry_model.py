"""Entry data shape and database row coercion."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from atlas.platform.database import db

__all__ = ["EntryModel", "_row_to_entry", "actor_quality", "trust_tier"]


@dataclass
class EntryModel:
    """Entry data model."""

    id: str
    type: str
    name: str
    description: str
    city: str | None
    state: str | None
    region: str | None
    geo_specificity: str
    latitude: float | None
    longitude: float | None
    geocode_precision: str | None
    geocode_source: str | None
    full_address: str | None
    website: str | None
    email: str | None
    phone: str | None
    social_media: dict[str, str] | None
    affiliated_org_id: str | None
    active: bool
    verified: bool
    last_verified: date | None
    contact_status: str
    editorial_notes: str | None
    priority: str | None
    first_seen: date
    last_seen: date
    created_at: str
    updated_at: str
    slug: str | None = None
    photo_url: str | None = None
    custom_bio: str | None = None
    claim_status: str = "unclaimed"
    claimed_by_user_id: str | None = None
    claim_verified_at: str | None = None
    last_confirmed_at: str | None = None
    linked_atproto_did: str | None = None
    linked_atproto_handle: str | None = None
    linked_atproto_verified_at: str | None = None
    suppressed_source_ids: list[str] = field(default_factory=list)
    preferred_contact_channel: str | None = None

    def to_dict(self, include_internal: bool = True) -> dict[str, Any]:
        """
        Convert entry to dictionary.

        Parameters
        ----------
        include_internal : bool, optional
            Include internal fields (contact_status, editorial_notes, priority).
            Default is True.

        Returns
        -------
        dict[str, Any]
            Entry as dictionary.
        """
        result = {
            "id": self.id,
            "type": self.type,
            "name": self.name,
            "description": self.description,
            "city": self.city,
            "state": self.state,
            "region": self.region,
            "geo_specificity": self.geo_specificity,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "geocode_precision": self.geocode_precision,
            "geocode_source": self.geocode_source,
            "full_address": self.full_address,
            "website": self.website,
            "email": self.email,
            "phone": self.phone,
            "social_media": self.social_media,
            "affiliated_org_id": self.affiliated_org_id,
            "active": self.active,
            "verified": self.verified,
            "last_verified": self.last_verified.isoformat() if self.last_verified else None,
            "first_seen": self.first_seen.isoformat(),
            "last_seen": self.last_seen.isoformat(),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "slug": self.slug,
        }
        if include_internal:
            result.update(
                {
                    "contact_status": self.contact_status,
                    "editorial_notes": self.editorial_notes,
                    "priority": self.priority,
                }
            )
        return result


def _row_to_entry(row: dict[str, Any]) -> EntryModel:
    """Convert database row to EntryModel."""
    suppressed_raw = row.get("suppressed_source_ids")
    suppressed: list[str] = []
    if isinstance(suppressed_raw, str) and suppressed_raw.strip():
        decoded = db.decode_json(suppressed_raw)
        if isinstance(decoded, list):
            suppressed = [str(item) for item in decoded]
    latitude_raw = row.get("latitude")
    longitude_raw = row.get("longitude")
    return EntryModel(
        id=row["id"],
        type=row["type"],
        name=row["name"],
        description=row["description"],
        city=row["city"],
        state=row["state"],
        region=row["region"],
        geo_specificity=row["geo_specificity"],
        latitude=float(latitude_raw) if latitude_raw is not None else None,
        longitude=float(longitude_raw) if longitude_raw is not None else None,
        geocode_precision=row.get("geocode_precision"),
        geocode_source=row.get("geocode_source"),
        full_address=row.get("full_address"),
        website=row["website"],
        email=row["email"],
        phone=row["phone"],
        social_media=db.decode_json(row["social_media"]) if row["social_media"] else None,  # type: ignore[arg-type]
        affiliated_org_id=row["affiliated_org_id"],
        active=bool(row["active"]),
        verified=bool(row["verified"]),
        last_verified=_row_date(row["last_verified"]) if row["last_verified"] else None,
        contact_status=row["contact_status"],
        editorial_notes=row["editorial_notes"],
        priority=row["priority"],
        first_seen=_row_date(row["first_seen"]),
        last_seen=_row_date(row["last_seen"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        slug=row.get("slug"),
        photo_url=row.get("photo_url"),
        custom_bio=row.get("custom_bio"),
        claim_status=row.get("claim_status") or "unclaimed",
        claimed_by_user_id=row.get("claimed_by_user_id"),
        claim_verified_at=row.get("claim_verified_at"),
        last_confirmed_at=row.get("last_confirmed_at"),
        linked_atproto_did=row.get("linked_atproto_did"),
        linked_atproto_handle=row.get("linked_atproto_handle"),
        linked_atproto_verified_at=row.get("linked_atproto_verified_at"),
        suppressed_source_ids=suppressed,
        preferred_contact_channel=row.get("preferred_contact_channel"),
    )


def _row_date(value: date | datetime | str) -> date:
    """Normalize SQLite/Postgres date column values to ``date``."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(value)


_MIN_CORROBORATING_SOURCES = 2
_ACTOR_QUALITY_TOTAL = 5
_PARTIAL_ACTOR_MIN_SCORE = 3


def actor_quality(
    entry: EntryModel,
    *,
    issue_area_ids: list[str],
    source_count: int,
) -> dict[str, object]:
    """Describe whether an entry is a concrete actor record.

    Parameters
    ----------
    entry : EntryModel
        Entry being serialized or ranked.
    issue_area_ids : list[str]
        Issue areas linked to the entry.
    source_count : int
        Number of sources linked to the entry.

    Returns
    -------
    dict[str, object]
        Specificity level plus present/missing slot names.
    """
    slots = {
        "actor": entry.type in {"person", "organization"},
        "work": bool((entry.description or "").strip() or (entry.custom_bio or "").strip()),
        "place": bool(
            entry.city
            or entry.state
            or entry.region
            or entry.full_address
            or entry.geo_specificity == "local"
        ),
        "issues": bool(issue_area_ids),
        "sources": source_count > 0,
    }
    present = [name for name, available in slots.items() if available]
    missing = [name for name, available in slots.items() if not available]
    score = len(present)
    if score == _ACTOR_QUALITY_TOTAL:
        level = "specific_actor"
    elif score >= _PARTIAL_ACTOR_MIN_SCORE:
        level = "partial_actor"
    else:
        level = "thin_record"
    return {
        "level": level,
        "score": score,
        "total": _ACTOR_QUALITY_TOTAL,
        "present": present,
        "missing": missing,
    }


def trust_tier(*, verified: bool, claim_status: str | None, independent_source_count: int) -> str:
    """Resolve the honest, never-overclaiming trust tier for an actor.

    The single source of truth for Atlas trust tiers, shared by the public record
    builder and the map projection so a dot's ring can never claim more than the
    profile it links to.

    Parameters
    ----------
    verified : bool
        Whether Atlas has verified the actor.
    claim_status : str | None
        The subject-claim lifecycle state; ``"verified"`` means the subject owns
        and confirmed the profile.
    independent_source_count : int
        Distinct registrable source domains backing the actor.

    Returns
    -------
    str
        ``subject_verified``, ``atlas_verified``, ``corroborated``, or
        ``unverified``.
    """
    if claim_status == "verified":
        return "subject_verified"
    if verified:
        return "atlas_verified"
    if independent_source_count >= _MIN_CORROBORATING_SOURCES:
        return "corroborated"
    return "unverified"


def _map_trust_level(
    *, verified: bool, claim_status: str | None, sources: list[dict[str, Any]]
) -> str:
    """Compute a map point's trust level from its linked sources.

    Reuses the canonical registrable-domain parser so the corroboration count
    matches the rest of the app exactly. Imported lazily to avoid a circular
    import with the MCP data layer.
    """
    from atlas.platform.mcp.data import _registrable_domain

    domains = {
        domain
        for source in sources
        if (domain := _registrable_domain(source.get("url"))) is not None
    }
    return trust_tier(
        verified=verified,
        claim_status=claim_status,
        independent_source_count=len(domains),
    )
