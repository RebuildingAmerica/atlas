"""Services for workspace directory domain verification."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol, cast

import dns.asyncresolver
import dns.exception

from atlas.domains.catalog.models.ownership import DirectoryDomainModel, OwnershipCRUD

if TYPE_CHECKING:
    import aiosqlite

DIRECTORY_DOMAIN_TXT_RESOLUTION_TIMEOUT_SECONDS = 5.0
DIRECTORY_DOMAIN_VERIFICATION_LABEL = "_atlas-verify"


def directory_domain_verification_host(domain: str) -> str:
    """Return the TXT host Atlas uses to verify ownership of ``domain``."""
    return f"{DIRECTORY_DOMAIN_VERIFICATION_LABEL}.{domain}"


class DirectoryDomainNotConfiguredError(Exception):
    """Raised when an org has no directory domain challenge to verify."""


class DirectoryDomainTxtResolver(Protocol):
    """Resolver capable of fetching TXT records for a directory domain."""

    async def resolve_txt_records(self, domain: str) -> set[str]:
        """Return TXT record values for ``domain``."""


class DnsDirectoryDomainTxtResolver:
    """TXT resolver backed by DNS lookups."""

    async def resolve_txt_records(self, domain: str) -> set[str]:
        """Resolve TXT records for a workspace directory domain."""
        resolver = dns.asyncresolver.Resolver()
        resolver.lifetime = DIRECTORY_DOMAIN_TXT_RESOLUTION_TIMEOUT_SECONDS
        try:
            answers = await resolver.resolve(domain, "TXT")
        except dns.exception.DNSException:
            return set()

        records: set[str] = set()
        for answer in answers:
            value = _txt_answer_value(answer)
            if value is not None:
                records.add(value)
        return records


def _txt_answer_value(answer: Any) -> str | None:
    """Normalize a dnspython TXT answer, ignoring malformed byte payloads."""
    chunks = getattr(answer, "strings", ())
    if chunks:
        try:
            return "".join(chunk.decode("utf-8") for chunk in chunks).strip()
        except UnicodeDecodeError:
            return None
    return cast("str", answer.to_text()).strip().strip('"')


@dataclass(frozen=True, slots=True)
class DirectoryDomainVerificationService:
    """Verify workspace directory-domain challenges using injected TXT lookup."""

    txt_resolver: DirectoryDomainTxtResolver
    ownership: type[OwnershipCRUD] = OwnershipCRUD

    async def verify(
        self,
        conn: aiosqlite.Connection,
        org_id: str,
    ) -> DirectoryDomainModel | None:
        """Verify the configured domain for ``org_id`` against live TXT records."""
        configured_domain = await self.ownership.get_directory_domain(conn, org_id)
        if configured_domain is None:
            raise DirectoryDomainNotConfiguredError

        txt_records = await self.txt_resolver.resolve_txt_records(
            directory_domain_verification_host(configured_domain.domain),
        )
        return await self.ownership.verify_directory_domain(
            conn,
            org_id=org_id,
            txt_records=txt_records,
        )
