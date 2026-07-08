"""Trust helpers for `atlas.platform.mcp.data`."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from atlas.domains.catalog.models.entry import EntryModel, trust_tier
from atlas.domains.catalog.schemas.public import ClaimEvidence, ClaimEvidenceSet

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

    from .data_record_helpers import EntityRecordContext


def _registrable_domain(url: str | None) -> str | None:
    """Return the lowercased registrable host for a URL, or None if unparseable."""
    if not url or "://" not in url:
        return None
    host = urlparse(url).netloc.lower()
    if host.startswith("www."):
        host = host.removeprefix("www.")
    return host or None


def _host_grounded(host: str, sources: Sequence[Mapping[str, Any]]) -> bool:
    """Whether a host is supported by any source's own domain or quoted context."""
    for source in sources:
        if host in (source.get("extraction_context") or "").lower():
            return True
        if _registrable_domain(source.get("url")) == host:
            return True
    return False


def _trust_inputs_from_sources(
    entry: EntryModel, sources: Sequence[Mapping[str, Any]]
) -> tuple[int, bool, bool]:
    """Derive corroboration breadth and contact grounding from linked sources."""
    domains = {
        domain
        for source in sources
        if (domain := _registrable_domain(source.get("url"))) is not None
    }
    website_host = _registrable_domain(entry.website)
    website_grounded = website_host is not None and _host_grounded(website_host, sources)
    email = (entry.email or "").lower()
    email_grounded = bool(email) and any(
        email in (source.get("extraction_context") or "").lower() for source in sources
    )
    return len(domains), website_grounded, email_grounded


def _contact_source_ids(entry: EntryModel, sources: Sequence[Mapping[str, Any]]) -> list[str]:
    """Return source IDs whose URL or context supports visible contact fields."""
    website_host = _registrable_domain(entry.website)
    email = (entry.email or "").lower()
    source_ids: list[str] = []
    for source in sources:
        context = (source.get("extraction_context") or "").lower()
        supports_website = website_host is not None and (
            website_host in context or _registrable_domain(source.get("url")) == website_host
        )
        supports_email = bool(email) and email in context
        if supports_website or supports_email:
            source_id = source.get("id")
            if source_id is not None:
                source_ids.append(str(source_id))
    return source_ids


def _trust_level(*, entry: EntryModel, independent_source_count: int | None) -> str:
    """Honest trust tier; never overclaims for thinly-sourced auto entries."""
    return trust_tier(
        verified=entry.verified,
        claim_status=entry.claim_status,
        independent_source_count=independent_source_count or 0,
    )


def _claim_confidence(
    *,
    entry: EntryModel,
    independent_source_count: int | None,
    source_count: int,
) -> str:
    """Return a confidence label for source-backed visible profile claims."""
    level = _trust_level(entry=entry, independent_source_count=independent_source_count)
    if level in {"subject_verified", "atlas_verified", "corroborated"}:
        return level
    return "unverified" if source_count <= 1 else "corroborated"


def _contact_claim_source_count(entry: EntryModel, context: EntityRecordContext) -> int:
    """Count visible contact channels backed by linked-source evidence."""
    count = 0
    if entry.website and context.website_grounded:
        count += 1
    if entry.email and context.email_grounded:
        count += 1
    return count


def _contact_claim_confidence(entry: EntryModel, context: EntityRecordContext) -> str:
    """Return a conservative confidence label for visible contact fields."""
    visible_channels = int(bool(entry.website)) + int(bool(entry.email)) + int(bool(entry.phone))
    if visible_channels == 0:
        return "unverified"

    grounded_channels = _contact_claim_source_count(entry, context)
    if grounded_channels == visible_channels:
        return _claim_confidence(
            entry=entry,
            independent_source_count=context.independent_source_count,
            source_count=max(grounded_channels, context.source_count),
        )
    if grounded_channels > 0:
        return "partial"
    return "unverified"


def _claim_evidence_set(
    *,
    entry: EntryModel,
    context: EntityRecordContext,
    verification_level: str,
) -> ClaimEvidenceSet:
    """Build evidence metadata for the visible facts on a profile."""
    base = ClaimEvidence(
        source_count=context.source_count,
        source_ids=context.source_ids,
        confidence=_claim_confidence(
            entry=entry,
            independent_source_count=context.independent_source_count,
            source_count=context.source_count,
        ),
        as_of=context.latest_source_date,
        verification_level=verification_level,
    )
    return ClaimEvidenceSet(
        summary=base,
        place=base,
        issues=base,
        contact=ClaimEvidence(
            source_count=(
                len(context.contact_source_ids)
                if context.contact_source_ids
                else _contact_claim_source_count(entry, context)
            ),
            source_ids=context.contact_source_ids,
            confidence=_contact_claim_confidence(entry, context),
            as_of=context.latest_source_date,
            verification_level=verification_level,
        ),
    )


__all__ = [name for name in globals() if not name.startswith("__")]
