"""Officers named on a nonprofit's IRS Form 990, read without an API key.

The register search names organizations but never people: ProPublica's API
reports officer pay as a percentage and nothing else. The return itself lists
every officer, director and trustee by name and title, so this module finds a
filer's most recent electronic return and reads those names from it.

Three public sources chain together. ProPublica's organization page, which its
robots.txt permits crawling, links every e-filed return by IRS object id. The
IRS downloads page lists the archives each processing year's returns ship in.
Those archives honour byte ranges, so ``remote_zip`` pulls a single return out
of a 100 MB archive without downloading the rest.

This module only locates and reads returns. What a return says about each
listed name, including whether it is a person at all, lives in
``filing_returns``, and deciding what Atlas publishes from that is the API's
resolution stage.
"""

from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date
from html.parser import HTMLParser
from pathlib import PurePosixPath
from typing import TYPE_CHECKING
from urllib.parse import parse_qs, urlsplit
from xml.etree.ElementTree import ParseError

import httpx
from defusedxml import DefusedXmlException

from atlas_discovery_engine.filing_returns import FilingOfficer, parse_return
from atlas_discovery_engine.registry import ATLAS_USER_AGENT, ProPublicaRegistryProvider
from atlas_discovery_engine.remote_zip import (
    RemoteMember,
    RemoteZipError,
    read_central_directory,
    read_member,
)

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence

logger = logging.getLogger(__name__)

__all__ = [
    "IRS_DOWNLOADS_PAGE",
    "FilingOfficerProvider",
    "IrsFilingOfficerProvider",
    "OrganizationFiling",
]

IRS_DOWNLOADS_PAGE = "https://www.irs.gov/charities-non-profits/form-990-series-downloads"
_IRS_ARCHIVE_HOST = "apps.irs.gov"
_FILINGS_TRIED_PER_ORGANIZATION = 2


@dataclass(frozen=True)
class OrganizationFiling:
    """The officers one organization named on one return."""

    ein: str
    """The filer's EIN."""

    object_id: str
    """The IRS identifier of the return the officers came from."""

    officers: tuple[FilingOfficer, ...]
    """Everyone the return names, in filing order."""

    return_type: str | None = None
    """``990``, ``990EZ`` or ``990PF``, as the return header records it."""

    tax_period_end: date | None = None
    """The last day of the tax period the return covers."""

    @property
    def source_url(self) -> str:
        """Public page for this exact return, cited as the officers' source."""
        return f"{ProPublicaRegistryProvider.ORGANIZATION_URL}/{self.ein}/{self.object_id}/full"


class _LinkCollector(HTMLParser):
    """Collects every anchor href on a page."""

    def __init__(self) -> None:
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        href = dict(attrs).get("href")
        if tag == "a" and href:
            self.hrefs.append(href)


def _hrefs(page: str) -> list[str]:
    """Return the anchor hrefs on an HTML page, in document order."""
    collector = _LinkCollector()
    collector.feed(page)
    collector.close()
    return collector.hrefs


class FilingOfficerProvider(ABC):
    """The contract every filing-officer adapter must satisfy."""

    @abstractmethod
    async def filings_for(self, eins: Sequence[str]) -> list[OrganizationFiling]:
        """Return the most recent return with named officers for each EIN.

        Implementations must not raise on a transient failure. An EIN whose
        return cannot be found or read is left out.

        Parameters
        ----------
        eins : Sequence[str]
            Filers to look up.

        Returns
        -------
        list[OrganizationFiling]
            One filing per EIN that yielded officers, in the order given.
        """


class IrsFilingOfficerProvider(FilingOfficerProvider):
    """Reads officers from IRS e-file archives, located through ProPublica."""

    def __init__(
        self,
        *,
        client_factory: Callable[[], httpx.AsyncClient] | None = None,
        concurrency: int = 4,
        timeout: float = 60.0,
        user_agent: str = ATLAS_USER_AGENT,
    ) -> None:
        """Configure the adapter.

        Parameters
        ----------
        client_factory : Callable[[], httpx.AsyncClient] | None, optional
            Builds the HTTP client. Tests pass one backed by a mock transport.
        concurrency : int, optional
            Organization pages fetched at once. ProPublica is a free public
            service, so the default stays low. Default is 4.
        timeout : float, optional
            Per-request timeout in seconds. Default is 60.0.
        user_agent : str, optional
            Identifier sent with each request.
        """
        headers = {"User-Agent": user_agent}
        self._client_factory = client_factory or (
            lambda: httpx.AsyncClient(timeout=timeout, headers=headers, follow_redirects=True)
        )
        self._concurrency = concurrency
        self._archive_urls: dict[str, list[str]] | None = None

    async def filings_for(self, eins: Sequence[str]) -> list[OrganizationFiling]:
        """Locate, read and parse the newest usable return for each EIN."""
        async with self._client_factory() as client:
            gate = asyncio.Semaphore(self._concurrency)
            object_ids = await asyncio.gather(*(self._object_ids(client, gate, e) for e in eins))
            candidates = {
                ein: ids[:_FILINGS_TRIED_PER_ORGANIZATION]
                for ein, ids in zip(eins, object_ids, strict=True)
            }
            wanted = {object_id for ids in candidates.values() for object_id in ids}
            members = await self._locate(client, wanted)

            filings: list[OrganizationFiling] = []
            for ein, ids in candidates.items():
                filing = await self._first_filing_with_officers(client, ein, ids, members)
                if filing is not None:
                    filings.append(filing)
        logger.info(
            "Filing officer lookup completed",
            extra={"organizations": len(eins), "filings": len(filings)},
        )
        return filings

    async def _object_ids(
        self, client: httpx.AsyncClient, gate: asyncio.Semaphore, ein: str
    ) -> list[str]:
        """List an EIN's e-filed return ids, newest first."""
        async with gate:
            try:
                response = await client.get(f"{ProPublicaRegistryProvider.ORGANIZATION_URL}/{ein}")
                response.raise_for_status()
            except httpx.HTTPError as error:
                logger.warning(
                    "Organization filing list failed",
                    extra={"ein": ein, "reason": type(error).__name__},
                )
                return []
        object_ids = {
            value
            for href in _hrefs(response.text)
            for value in parse_qs(urlsplit(href).query).get("object_id", [])
            if value.isdigit()
        }
        # Object ids begin with the processing year and then count upward, so
        # sorting them descending puts the newest return first.
        return sorted(object_ids, reverse=True)

    async def _locate(
        self, client: httpx.AsyncClient, object_ids: set[str]
    ) -> dict[str, RemoteMember]:
        """Find which archive holds each return, reading each year's archives in turn."""
        by_year: dict[str, set[str]] = {}
        for object_id in object_ids:
            by_year.setdefault(object_id[:4], set()).add(f"{object_id}_public.xml")
        if not by_year:
            return {}

        archives = await self._archives(client)
        located: dict[str, RemoteMember] = {}
        for year, names in sorted(by_year.items(), reverse=True):
            remaining = set(names)
            for url in archives.get(year, []):
                if not remaining:
                    break
                try:
                    found = await read_central_directory(client, url, remaining.__contains__)
                except (httpx.HTTPError, RemoteZipError) as error:
                    logger.warning(
                        "Filing archive directory failed",
                        extra={"url": url, "reason": type(error).__name__},
                    )
                    continue
                located.update(found)
                remaining -= found.keys()
        return located

    async def _archives(self, client: httpx.AsyncClient) -> dict[str, list[str]]:
        """Map each processing year to the archive URLs the IRS lists for it.

        The list changes when the IRS publishes a batch, roughly monthly, and
        a run looks returns up in several batches, so one read per provider is
        kept. A failed read is not kept, so the next batch tries again.
        """
        if self._archive_urls is not None:
            return self._archive_urls
        try:
            response = await client.get(IRS_DOWNLOADS_PAGE)
            response.raise_for_status()
        except httpx.HTTPError as error:
            logger.warning("IRS archive list failed", extra={"reason": type(error).__name__})
            return {}
        archives: dict[str, list[str]] = {}
        for href in _hrefs(response.text):
            parts = urlsplit(href)
            path = PurePosixPath(parts.path)
            year = path.parent.name
            if (
                parts.hostname != _IRS_ARCHIVE_HOST
                or path.suffix != ".zip"
                or not path.name.startswith(f"{year}_TEOS_XML_")
            ):
                continue
            urls = archives.setdefault(year, [])
            if href not in urls:
                urls.append(href)
        self._archive_urls = archives
        return archives

    async def _first_filing_with_officers(
        self,
        client: httpx.AsyncClient,
        ein: str,
        object_ids: Sequence[str],
        members: dict[str, RemoteMember],
    ) -> OrganizationFiling | None:
        """Read candidate returns newest first, stopping at one that names officers."""
        for object_id in object_ids:
            member = members.get(f"{object_id}_public.xml")
            if member is None:
                continue
            try:
                parsed = parse_return(await read_member(client, member))
            except (httpx.HTTPError, RemoteZipError, ParseError, DefusedXmlException) as error:
                logger.warning(
                    "Filing read failed",
                    extra={"object_id": object_id, "reason": type(error).__name__},
                )
                continue
            if parsed.officers:
                return OrganizationFiling(
                    ein=ein,
                    object_id=object_id,
                    officers=parsed.officers,
                    return_type=parsed.return_type,
                    tax_period_end=parsed.tax_period_end,
                )
        return None
