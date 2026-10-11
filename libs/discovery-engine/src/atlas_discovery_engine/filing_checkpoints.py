"""Resume filing research between archives instead of restarting a long scan.

Only source identifiers and parsed evidence cross invocations. Each call opens
its own client and completes at most one organization page, catalog, archive
directory, or return read. Directory parsing and decompression still require
hosted CPU/memory proof; the unit boundary does not claim to preempt Python CPU.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field, replace

import httpx

from atlas_discovery_engine.filings import (
    _FILINGS_TRIED_PER_ORGANIZATION,
    IrsFilingOfficerProvider,
    OrganizationFiling,
)
from atlas_discovery_engine.remote_zip import RemoteMember, RemoteZipError, read_central_directory

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FilingCheckpoint:
    """Serializable progress for one fixed, ordered batch of registry EINs."""

    eins: tuple[str, ...]
    object_ids: dict[str, list[str]] = field(default_factory=dict)
    archives: dict[str, list[str]] | None = None
    scanned: tuple[str, ...] = ()
    members: dict[str, RemoteMember] = field(default_factory=dict)
    attempted: tuple[str, ...] = ()
    filings: tuple[OrganizationFiling, ...] = ()
    done: bool = False


async def advance_filing_lookup(
    provider: IrsFilingOfficerProvider, state: FilingCheckpoint
) -> FilingCheckpoint:
    """Complete one source unit, returning new progress for the caller to persist.

    A cancelled or unexpectedly failing unit leaves its input checkpoint intact.
    Expected source failures retain the existing provider's skip semantics. The
    caller owns persistence and must fence the write against its active job lease.
    """
    if state.done:
        return state
    async with provider._client_factory() as client:
        for ein in state.eins:
            if ein not in state.object_ids:
                identifiers = await provider._object_ids(client, asyncio.Semaphore(1), ein)
                return replace(
                    state,
                    object_ids={
                        **state.object_ids,
                        ein: identifiers[:_FILINGS_TRIED_PER_ORGANIZATION],
                    },
                )

        by_year: dict[str, set[str]] = {}
        for identifiers in state.object_ids.values():
            for identifier in identifiers:
                by_year.setdefault(identifier[:4], set()).add(f"{identifier}_public.xml")
        if not by_year:
            return replace(state, done=True)
        if state.archives is None:
            return replace(state, archives=await provider._archives(client))

        for year, names in sorted(by_year.items(), reverse=True):
            remaining = names - state.members.keys()
            if not remaining:
                continue
            for url in state.archives.get(year, []):
                if url in state.scanned:
                    continue
                try:
                    found = await read_central_directory(client, url, remaining.__contains__)
                except (httpx.HTTPError, RemoteZipError) as error:
                    logger.warning(
                        "Filing archive directory failed",
                        extra={"url": url, "reason": type(error).__name__},
                    )
                    found = {}
                return replace(
                    state, members={**state.members, **found}, scanned=(*state.scanned, url)
                )

        completed_eins = {filing.ein for filing in state.filings}
        for ein in state.eins:
            if ein in completed_eins:
                continue
            for identifier in state.object_ids[ein]:
                key = f"{ein}:{identifier}"
                if key in state.attempted or f"{identifier}_public.xml" not in state.members:
                    continue
                filing = await provider._first_filing_with_officers(
                    client, ein, [identifier], state.members
                )
                return replace(
                    state,
                    attempted=(*state.attempted, key),
                    filings=(*state.filings, filing) if filing is not None else state.filings,
                )
        return replace(state, done=True)
