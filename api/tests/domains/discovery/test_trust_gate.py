"""Tests for the hybrid publication gate decision logic."""

import pytest

from atlas.domains.discovery.trust_gate import (
    PUBLISH,
    GateDecision,
    evaluate_publication,
    evaluate_resolved_person,
)


def test_person_found_only_on_the_web_is_held() -> None:
    """A web page is not enough to publish claims about a named individual."""
    decision = evaluate_publication(kind="person", dedup_suspect=False, score=0.99)
    assert decision == GateDecision(publish=False, hold_reason="person_requires_review")


def test_web_organization_is_held_as_uncorroborated() -> None:
    decision = evaluate_publication(kind="organization", dedup_suspect=False, score=0.8)
    assert decision == GateDecision(publish=False, hold_reason="uncorroborated_web_only")


def test_dedup_suspect_is_held_first() -> None:
    decision = evaluate_publication(kind="person", dedup_suspect=True, score=0.9)
    assert decision == GateDecision(publish=False, hold_reason="dedup_suspect")


def test_a_resolved_person_with_a_current_role_publishes() -> None:
    """A recent return listing someone, with nothing contradicting it, is authoritative."""
    decision = evaluate_resolved_person(
        type_conflict=False, identity_ambiguous=False, current_role=True
    )
    assert decision == PUBLISH


@pytest.mark.parametrize(
    ("type_conflict", "identity_ambiguous", "current_role", "reason"),
    [
        (True, True, False, "type_conflict"),
        (False, True, False, "identity_ambiguous"),
        (False, False, False, "no_current_role"),
    ],
)
def test_a_resolved_person_holds_on_the_first_unmet_condition(
    *, type_conflict: bool, identity_ambiguous: bool, current_role: bool, reason: str
) -> None:
    decision = evaluate_resolved_person(
        type_conflict=type_conflict,
        identity_ambiguous=identity_ambiguous,
        current_role=current_role,
    )
    assert decision == GateDecision(publish=False, hold_reason=reason)
