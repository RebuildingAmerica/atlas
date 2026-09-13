"""Hybrid publication gate for discovered records.

Pure decision logic (no I/O) so the rules are exhaustively testable. The
caller supplies the few signals the rules need; this module decides whether a
record may be published directly or must be held for human review.

There are two gates because there are two kinds of evidence. A record extracted
from a web page carries only the page's text, so it never publishes on its own.
A record resolved from an authoritative filing carries structure the resolver
checked, so it publishes when that structure is unambiguous.
"""

from dataclasses import dataclass

__all__ = ["GateDecision", "evaluate_publication", "evaluate_resolved_person"]


@dataclass(frozen=True)
class GateDecision:
    """Outcome of the publication gate.

    Parameters
    ----------
    publish : bool
        True if the record may be written active/public immediately.
    hold_reason : str | None
        Machine-readable reason the record is held; None when published.
    """

    publish: bool
    hold_reason: str | None


PUBLISH = GateDecision(publish=True, hold_reason=None)


def evaluate_publication(
    *,
    kind: str,
    dedup_suspect: bool,
    score: float,
) -> GateDecision:
    """Decide what happens to a record extracted from a web page.

    Rules (in priority order):
    1. A possible duplicate is held, because merging is a reviewer decision.
    2. A person is held, because wrong facts about a named individual are the
       core liability and a web page is not enough to publish one.
    3. Everything else is held as uncorroborated web-only.

    A page's URL is never treated as corroboration. A page on a registry's
    domain is still a page, and only the resolution stage, which reads the
    registry's structured record, may publish from a registry.

    Parameters
    ----------
    kind : str
        The discovered record's entity type (e.g. ``person``, ``organization``).
    dedup_suspect : bool
        True when deduplication flagged the record as a possible duplicate.
    score : float
        The record's confidence score (reserved for future thresholds).

    Returns
    -------
    GateDecision
        Why the record is held.
    """
    _ = score
    if dedup_suspect:
        return GateDecision(publish=False, hold_reason="dedup_suspect")
    if kind == "person":
        return GateDecision(publish=False, hold_reason="person_requires_review")
    return GateDecision(publish=False, hold_reason="uncorroborated_web_only")


def evaluate_resolved_person(
    *,
    type_conflict: bool,
    identity_ambiguous: bool,
    current_role: bool,
) -> GateDecision:
    """Decide what happens to a person resolved from an IRS return.

    Rules (in priority order):
    1. A row whose signals disagree about whether it names a person is held.
    2. A name that could belong to another person already in the state is
       held, because merging or splitting people is a reviewer decision.
    3. A person whose only role is former or on a stale return is held, so
       Atlas never presents an old board as the current one.
    4. Otherwise the return is authoritative and the person publishes.

    Parameters
    ----------
    type_conflict : bool
        True when the return's structure or the name itself suggests the row
        is not a person.
    identity_ambiguous : bool
        True when another person with the same name exists nearby and nothing
        ties either to this organization.
    current_role : bool
        True when the return is recent and does not mark the role as left.

    Returns
    -------
    GateDecision
        Whether the person may publish and, if not, why they are held.
    """
    if type_conflict:
        return GateDecision(publish=False, hold_reason="type_conflict")
    if identity_ambiguous:
        return GateDecision(publish=False, hold_reason="identity_ambiguous")
    if not current_role:
        return GateDecision(publish=False, hold_reason="no_current_role")
    return PUBLISH
