"""Hosted identity and ownership checks use request-owned public DNS."""

from unittest.mock import AsyncMock

import pytest

from atlas.domains.catalog.services.atproto_identity import _resolve_handle_dns
from atlas.domains.catalog.services.directory_domains import DnsDirectoryDomainTxtResolver
from atlas.platform.config import Settings
from atlas.platform.hosted_runtime import HostedRuntime, bind_hosted_runtime


@pytest.mark.asyncio
async def test_hosted_txt_records_verify_handles_and_domain_challenges_without_system_dns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def no_system_resolver() -> None:
        raise FileNotFoundError("/etc/resolv.conf")

    monkeypatch.setattr("dns.asyncresolver.Resolver", no_system_resolver)
    lookup = AsyncMock(return_value=("other-record", "did=did:plc:verified"))
    runtime = HostedRuntime(
        settings=Settings(multi_user=False), connect=AsyncMock(), dns_txt_lookup=lookup
    )
    with bind_hosted_runtime(runtime):
        assert await _resolve_handle_dns("example.org") == "did:plc:verified"
        lookup.assert_awaited_with("_atproto.example.org")
        lookup.return_value = ("atlas-verification=challenge",)
        assert await _resolve_handle_dns("example.org") is None
        assert await DnsDirectoryDomainTxtResolver().resolve_txt_records(
            "_atlas-verify.example.org"
        ) == {"atlas-verification=challenge"}
        lookup.assert_awaited_with("_atlas-verify.example.org")
        lookup.return_value = ()
        assert await _resolve_handle_dns("example.org") is None
