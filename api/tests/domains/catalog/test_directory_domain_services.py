"""Tests for workspace directory domain verification services."""

from __future__ import annotations

import pytest

from atlas.domains.catalog.models import ownership
from atlas.domains.catalog.models.ownership import OwnershipCRUD
from atlas.domains.catalog.services import directory_domains
from atlas.domains.catalog.services.directory_domains import (
    DirectoryDomainNotConfiguredError,
    DirectoryDomainVerificationService,
    DnsDirectoryDomainTxtResolver,
)


class _FakeTxtResolver:
    """In-memory TXT resolver used to prove resolver injection."""

    def __init__(self, records_by_domain: dict[str, set[str]]) -> None:
        self.records_by_domain = records_by_domain
        self.queries: list[str] = []

    async def resolve_txt_records(self, domain: str) -> set[str]:
        """Return configured TXT records for ``domain``."""
        self.queries.append(domain)
        return self.records_by_domain.get(domain, set())


class _FakeDnsResolver:
    """Fake dnspython async resolver."""

    def __init__(
        self,
        answers: list[object] | None = None,
        error: Exception | None = None,
        expected_domain: str = "guide.kctenants.org",
    ) -> None:
        self.answers = answers or []
        self.error = error
        self.expected_domain = expected_domain
        self.lifetime = 0.0

    async def resolve(self, domain: str, record_type: str) -> list[object]:
        """Return configured answers or raise the configured DNS error."""
        assert domain == self.expected_domain
        assert record_type == "TXT"
        if self.error is not None:
            raise self.error
        return self.answers


class _ChunkedTxtAnswer:
    """TXT answer exposed as byte chunks."""

    strings = (b"atlas-", b"verify=chunked")


class _TextTxtAnswer:
    """TXT answer exposed through ``to_text`` only."""

    strings: tuple[bytes, ...] = ()

    def to_text(self) -> str:
        """Return a quoted TXT record."""
        return '"atlas-verify=text"'


class _InvalidUtf8TxtAnswer:
    """TXT answer containing bytes that cannot be decoded as UTF-8."""

    strings = (b"\xff",)


@pytest.mark.asyncio
async def test_directory_domain_verifier_uses_injected_txt_resolver(test_db: object) -> None:
    """Domain verification should depend on a resolver interface, not pasted request data."""
    configured = await OwnershipCRUD.upsert_directory_domain(
        test_db,
        org_id="local",
        domain="guide.kctenants.org",
    )
    resolver = _FakeTxtResolver(
        {"_atlas-verify.guide.kctenants.org": {configured.verification_token}},
    )
    verifier = DirectoryDomainVerificationService(txt_resolver=resolver)

    verified = await verifier.verify(test_db, "local")

    assert resolver.queries == ["_atlas-verify.guide.kctenants.org"]
    assert verified is not None
    assert verified.status == "verified"


@pytest.mark.asyncio
async def test_directory_domain_verifier_is_idempotent_for_verified_domain(
    test_db: object,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Repeated successful verification should not mutate verified domain state."""
    timestamps = iter(
        [
            "2026-01-01T00:00:00+00:00",
            "2026-01-02T00:00:00+00:00",
            "2026-01-03T00:00:00+00:00",
        ]
    )
    monkeypatch.setattr(ownership.db, "now_iso", lambda: next(timestamps))
    configured = await OwnershipCRUD.upsert_directory_domain(
        test_db,
        org_id="local",
        domain="guide.kctenants.org",
    )
    resolver = _FakeTxtResolver(
        {"_atlas-verify.guide.kctenants.org": {configured.verification_token}},
    )
    verifier = DirectoryDomainVerificationService(txt_resolver=resolver)

    first = await verifier.verify(test_db, "local")
    second = await verifier.verify(test_db, "local")

    assert first is not None
    assert first.status == "verified"
    assert first.verified_at == "2026-01-02T00:00:00+00:00"
    assert second is not None
    assert second.status == "verified"
    assert second.verified_at == first.verified_at


@pytest.mark.asyncio
async def test_directory_domain_verifier_reports_missing_configuration(test_db: object) -> None:
    """Missing domain configuration is distinct from a failed DNS proof."""
    verifier = DirectoryDomainVerificationService(txt_resolver=_FakeTxtResolver({}))

    with pytest.raises(DirectoryDomainNotConfiguredError):
        await verifier.verify(test_db, "local")


@pytest.mark.asyncio
async def test_dns_txt_resolver_normalizes_chunked_and_text_answers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DNS TXT resolution should normalize the answer shapes dnspython returns."""
    fake_resolver = _FakeDnsResolver([_ChunkedTxtAnswer(), _TextTxtAnswer()])
    monkeypatch.setattr(
        directory_domains.dns.asyncresolver,
        "Resolver",
        lambda: fake_resolver,
    )

    records = await DnsDirectoryDomainTxtResolver().resolve_txt_records("guide.kctenants.org")

    assert (
        fake_resolver.lifetime == directory_domains.DIRECTORY_DOMAIN_TXT_RESOLUTION_TIMEOUT_SECONDS
    )
    assert records == {"atlas-verify=chunked", "atlas-verify=text"}


@pytest.mark.asyncio
async def test_dns_txt_resolver_ignores_malformed_txt_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Malformed TXT records should not crash verification attempts."""
    fake_resolver = _FakeDnsResolver([_InvalidUtf8TxtAnswer(), _TextTxtAnswer()])
    monkeypatch.setattr(
        directory_domains.dns.asyncresolver,
        "Resolver",
        lambda: fake_resolver,
    )

    records = await DnsDirectoryDomainTxtResolver().resolve_txt_records("guide.kctenants.org")

    assert records == {"atlas-verify=text"}


@pytest.mark.asyncio
async def test_dns_txt_resolver_returns_empty_set_on_dns_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DNS lookup failures should leave the domain pending, not crash the request."""
    fake_resolver = _FakeDnsResolver(
        error=directory_domains.dns.exception.DNSException("lookup failed"),
    )
    monkeypatch.setattr(
        directory_domains.dns.asyncresolver,
        "Resolver",
        lambda: fake_resolver,
    )

    records = await DnsDirectoryDomainTxtResolver().resolve_txt_records("guide.kctenants.org")

    assert records == set()
