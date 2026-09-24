"""Trust and profile-answer helpers for MCP entity records."""

from __future__ import annotations

from collections.abc import Mapping, Sequence  # noqa: TC003
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from atlas.domains.catalog.models.entry import trust_tier
from atlas.domains.catalog.schemas.public import ClaimEvidence, ClaimEvidenceSet, ProfileAnswers
from atlas.platform.mcp.data_parts.context import EntityRecordContext  # noqa: TC001
from atlas.platform.mcp.data_parts.place_utils import _format_place

if TYPE_CHECKING:
    from atlas.domains.catalog.models.entry import EntryModel


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


def _trust_level(*, entry: EntryModel) -> str:
    """Honest trust tier; never overclaims for thinly-sourced auto entries."""
    return trust_tier(
        verified=entry.verified,
        claim_status=entry.claim_status,
    )


def _contact_claim_source_count(context: EntityRecordContext) -> int:
    """Count receipts explicitly linked to the visible contact details."""
    return len(context.contact_source_ids)


def _contact_claim_confidence(context: EntityRecordContext) -> str:
    """A linked contact source is partial support, not verified contact ownership."""
    return "partial" if _contact_claim_source_count(context) > 0 else "unverified"


def _claim_evidence_set(
    *,
    context: EntityRecordContext,
    verification_level: str,
) -> ClaimEvidenceSet:
    """Build evidence metadata for the visible facts on a profile."""
    base = ClaimEvidence(
        source_count=0,
        source_ids=[],
        confidence="unverified",
        as_of=None,
        verification_level=verification_level,
    )
    return ClaimEvidenceSet(
        summary=base,
        place=base,
        issues=base,
        contact=ClaimEvidence(
            source_count=_contact_claim_source_count(context),
            source_ids=context.contact_source_ids,
            confidence=_contact_claim_confidence(context),
            as_of=None,
            verification_level=verification_level,
        ),
    )


def _humanize_identifier(value: str) -> str:
    """Convert API identifiers into compact labels for profile answers."""
    return value.replace("_", " ").replace("-", " ").title()


def _entity_type_label(entry: EntryModel) -> str:
    if entry.type == "person":
        return "Person"
    if entry.type == "organization":
        return "Organization"
    return _humanize_identifier(entry.type)


def _format_answer_evidence(source_count: int) -> str:
    """Name linked receipts without implying they support every visible claim."""
    if source_count == 0:
        return "No linked sources · claim support not reviewed"
    label = "source" if source_count == 1 else "sources"
    return f"{source_count} linked {label} · claim support not reviewed"


def _profile_answers(
    *,
    entry: EntryModel,
    context: EntityRecordContext,
) -> ProfileAnswers:
    """Build the scan-friendly actor summary used by app and agent clients."""
    issue_labels = [_humanize_identifier(slug) for slug in context.issue_area_ids]
    why_parts = [
        f"{context.source_count} {'source' if context.source_count == 1 else 'sources'}",
        *issue_labels[:2],
    ]
    return ProfileAnswers(
        who=_entity_type_label(entry),
        what_they_do=entry.description or ", ".join(issue_labels) or "Public civic actor",
        where=_format_place(entry.city, entry.state, entry.region) or "Location not specified",
        why_they_matter=" · ".join(why_parts),
        how_atlas_knows=_format_answer_evidence(context.source_count),
    )
