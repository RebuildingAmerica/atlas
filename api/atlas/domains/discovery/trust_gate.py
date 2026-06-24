"""Hybrid publication gate for discovered records.

Pure decision logic (no I/O) so the rules are exhaustively testable. The
caller supplies the few signals the rules need; this module decides whether a
record may be published directly or must be held for human review.
"""

from dataclasses import dataclass

__all__ = ["GateDecision", "evaluate_publication"]


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
    2. A person is always held — wrong facts about a named individual are the
       core liability.
    3. An organization auto-publishes only when corroborated by an authoritative
       registry (EIN/990/FEC). In Phase 0 no registry connectors exist yet, so
       ``registry_corroborated`` is effectively always False and orgs hold too —
       the intended conservative posture.
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
    if kind == "person":
        return GateDecision(publish=False, hold_reason="person_requires_review")
    if kind == "organization" and registry_corroborated:
        return GateDecision(publish=True, hold_reason=None)
    return GateDecision(publish=False, hold_reason="uncorroborated_web_only")
