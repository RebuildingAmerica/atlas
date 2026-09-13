"""Hybrid publication gate for discovered records.

Pure decision logic (no I/O) so the rules are exhaustively testable. The
caller supplies the few signals the rules need; this module decides whether a
record may be published directly or must be held for human review.
"""

from dataclasses import dataclass

__all__ = ["GateDecision", "evaluate_publication"]

# Only these kinds have an authoritative registry: the nonprofit register for an
# organization, and the return that names a person. A campaign or an event that
# happens to cite a register page is not corroborated by it.
_REGISTERED_KINDS = frozenset({"organization", "person"})


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


def evaluate_publication(
    *,
    kind: str,
    registry_corroborated: bool,
    dedup_suspect: bool,
    score: float,
) -> GateDecision:
    """Decide whether a discovered record may auto-publish.

    Rules (in priority order):
    1. A possible duplicate is always held — merging is a reviewer decision.
    2. An organization or person an authoritative registry corroborates
       publishes. For an organization that is its register filing; for a
       person it is the IRS return that names them.
    3. Any other person is held — wrong facts about a named individual are the
       core liability, and a web page is not enough to publish one.
    4. Everything else is held as uncorroborated web-only.

    Parameters
    ----------
    kind : str
        The discovered record's entity type (e.g. ``person``, ``organization``).
    registry_corroborated : bool
        True when an authoritative registry confirms the record.
    dedup_suspect : bool
        True when deduplication flagged the record as a possible duplicate.
    score : float
        The record's confidence score (reserved for future thresholds).

    Returns
    -------
    GateDecision
        Whether the record may publish and, if not, why it is held.
    """
    _ = score
    if dedup_suspect:
        return GateDecision(publish=False, hold_reason="dedup_suspect")
    if registry_corroborated and kind in _REGISTERED_KINDS:
        return GateDecision(publish=True, hold_reason=None)
    if kind == "person":
        return GateDecision(publish=False, hold_reason="person_requires_review")
    return GateDecision(publish=False, hold_reason="uncorroborated_web_only")
