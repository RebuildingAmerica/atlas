"""Tests for the hybrid publication gate decision logic."""

from atlas.domains.discovery.trust_gate import GateDecision, evaluate_publication


def test_person_is_always_held() -> None:
    decision = evaluate_publication(
        kind="person", registry_corroborated=True, dedup_suspect=False, score=0.99
    )
    assert decision == GateDecision(publish=False, hold_reason="person_requires_review")


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
