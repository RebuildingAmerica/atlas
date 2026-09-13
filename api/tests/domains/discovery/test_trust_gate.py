"""Tests for the hybrid publication gate decision logic."""

from atlas.domains.discovery.trust_gate import GateDecision, evaluate_publication


def test_person_named_on_a_filing_auto_publishes() -> None:
    """A federal return listing someone is authoritative evidence they hold the role."""
    decision = evaluate_publication(
        kind="person", registry_corroborated=True, dedup_suspect=False, score=0.2
    )
    assert decision == GateDecision(publish=True, hold_reason=None)


def test_person_found_only_on_the_web_is_held() -> None:
    """A web page is not enough to publish claims about a named individual."""
    decision = evaluate_publication(
        kind="person", registry_corroborated=False, dedup_suspect=False, score=0.99
    )
    assert decision == GateDecision(publish=False, hold_reason="person_requires_review")


def test_possible_duplicate_person_is_held_even_with_a_filing() -> None:
    """One officer on two boards is a merge decision, whatever the filing says."""
    decision = evaluate_publication(
        kind="person", registry_corroborated=True, dedup_suspect=True, score=0.9
    )
    assert decision == GateDecision(publish=False, hold_reason="dedup_suspect")


def test_registry_corroborated_org_auto_publishes() -> None:
    decision = evaluate_publication(
        kind="organization", registry_corroborated=True, dedup_suspect=False, score=0.8
    )
    assert decision.publish is True
    assert decision.hold_reason is None


def test_uncorroborated_org_is_held() -> None:
    decision = evaluate_publication(
        kind="organization", registry_corroborated=False, dedup_suspect=False, score=0.8
    )
    assert decision == GateDecision(publish=False, hold_reason="uncorroborated_web_only")


def test_dedup_suspect_is_held_even_if_corroborated() -> None:
    decision = evaluate_publication(
        kind="organization", registry_corroborated=True, dedup_suspect=True, score=0.8
    )
    assert decision == GateDecision(publish=False, hold_reason="dedup_suspect")


def test_a_corroborated_campaign_is_not_published_by_a_register_page() -> None:
    """Only organizations and people have a registry; a campaign citing one does not."""
    decision = evaluate_publication(
        kind="campaign", registry_corroborated=True, dedup_suspect=False, score=0.9
    )
    assert decision == GateDecision(publish=False, hold_reason="uncorroborated_web_only")
