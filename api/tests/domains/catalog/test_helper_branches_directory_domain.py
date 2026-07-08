"""Tests for catalog helper branches."""
# ruff: noqa

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from atlas.domains.catalog.api import org_resources
from atlas.domains.catalog.models import ownership, profile_claims
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.catalog.services.directory_domains import (
    DirectoryDomainNotConfiguredError,
    DirectoryDomainVerificationService,
)


@pytest.mark.parametrize(
    "decoded",
    [
        {"unexpected": True},
        ["good", 1],
    ],
)
def test_decode_string_list_rejects_malformed_json(
    monkeypatch: pytest.MonkeyPatch,
    decoded: object,
) -> None:
    """Ownership helpers should fail closed on malformed JSON arrays."""
    monkeypatch.setattr(ownership.db, "decode_json", lambda _value: decoded)

    with pytest.raises(ValueError, match="must contain a JSON array of strings"):
        ownership._decode_string_list("[]", "issue_areas")


def test_default_verified_proof_summary_falls_back_without_domain() -> None:
    """Proof summaries should stay plain when the email domain is missing."""
    assert (
        profile_claims._default_verified_proof_summary(
            "email_domain",
            {"user_email_domain": ""},
        )
        == "Verified by reviewer decision."
    )


@pytest.mark.parametrize(
    ("entry", "expected"),
    [
        (SimpleNamespace(address=SimpleNamespace(city="Gary", state=None, region=None)), "Gary"),
        (SimpleNamespace(address=SimpleNamespace(city=None, state="IN", region=None)), "IN"),
        (
            SimpleNamespace(address=SimpleNamespace(city=None, state=None, region="Midwest")),
            "Midwest",
        ),
    ],
)
def test_geography_label_falls_back_to_city_state_or_region(
    entry: object,
    expected: str,
) -> None:
    """Geography labels should degrade gracefully when pieces are missing."""
    assert org_resources._geography_label(entry) == expected


def test_effective_public_directory_scope_preserves_configured_values_when_present() -> None:
    """Configured directory metadata should override only the fields it sets."""
    entry = SimpleNamespace(
        issue_area_ids=["housing_affordability"],
        type="organization",
        source_count=1,
        address=SimpleNamespace(city="Gary", state="IN", region="Midwest"),
        freshness=SimpleNamespace(latest_source_date="2026-01-03T00:00:00Z"),
        sources=[],
        claim_evidence=SimpleNamespace(summary=SimpleNamespace(source_count=1)),
    )
    config = SimpleNamespace(
        issue_area_ids=[],
        geography_labels=["Detroit, MI"],
        entry_types=[],
        title=None,
        sponsor_label=None,
        methodology_summary=None,
        source_policy=None,
        review_policy=None,
        correction_policy=None,
        correction_path_template=None,
        missing_context_path_template=None,
    )

    scope = org_resources._effective_public_directory_scope([entry], config)

    assert scope.issue_area_ids == ["housing_affordability"]
    assert scope.geography_labels == ["Detroit, MI"]
    assert scope.entry_types == ["organization"]


def test_directory_config_response_returns_defaults_when_missing() -> None:
    """An absent config should still yield a stable response shell."""
    response = org_resources._directory_config_response("local", None)
    assert response.org_id == "local"


def test_directory_config_methodology_uses_defaults_for_blank_fields() -> None:
    """Blank methodology fields should fall back to the public defaults."""
    config = SimpleNamespace(
        methodology_summary="",
        source_policy="",
        review_policy="",
        correction_policy="",
        correction_path_template="",
        missing_context_path_template="",
    )

    methodology = org_resources._directory_config_methodology(config)

    assert methodology.summary
    assert methodology.source_policy


def test_get_directory_domain_verifier_returns_service() -> None:
    """The verifier factory should return the directory-domain service wrapper."""
    verifier = org_resources.get_directory_domain_verifier()
    assert isinstance(verifier, DirectoryDomainVerificationService)


@pytest.mark.parametrize(
    "value",
    [
        "127.0.0.1",
        "a" * 250 + ".com",
    ],
)
def test_normalize_directory_domain_rejects_ip_and_overlong_domains(value: str) -> None:
    """Directory domains should reject raw IPs and oversize hostnames."""
    with pytest.raises(ValueError, match="Enter a bare domain name"):
        org_resources._normalize_directory_domain(value)


def test_normalize_directory_domain_rejects_missing_dot() -> None:
    """Bare hostnames without a public suffix should be rejected."""
    with pytest.raises(ValueError, match="Enter a bare domain name"):
        org_resources._normalize_directory_domain("localhost")
