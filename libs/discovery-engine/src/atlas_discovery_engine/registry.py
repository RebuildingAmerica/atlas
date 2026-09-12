"""Nonprofit registry lookup, an alternative to open-web search.

Web search finds an organization by reading about it, which needs a paid search
vendor and a page that survives a fetch. A registry names the organization
directly: the IRS knows every US nonprofit by name, city and EIN, and
ProPublica republishes that as a public JSON API with no key.

Registry results carry weaker signal than a news article -- an EIN proves an
organization filed a return, not that anyone is doing anything worth finding --
so they arrive as candidates for the same scoring and trust gates that web
results go through, not as a shortcut past them.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

__all__ = [
    "ProPublicaRegistryProvider",
    "RegistryOrganization",
    "RegistryProvider",
]


@dataclass(frozen=True)
class RegistryOrganization:
    """One organization as a public nonprofit registry describes it."""

    name: str
    """Legal name on the organization's filings."""

    city: str | None
    """City the organization filed from."""

    state: str | None
    """Two-letter state code the organization filed from."""

    registry_id: str
    """The registry's own identifier. For the IRS this is the EIN."""

    source_url: str
    """Public page citing this organization, used as the entry's source."""

    category_code: str | None = None
    """Registry classification, such as an NTEE code."""

    website: str | None = None
    """Primary website, when the registry publishes one."""


class RegistryProvider(ABC):
    """The contract every nonprofit registry adapter must satisfy."""

    @abstractmethod
    async def search_organizations(
        self,
        term: str,
        state: str,
        *,
        limit: int,
    ) -> list[RegistryOrganization]:
        """Return organizations matching ``term`` within ``state``.

        Implementations must not raise on a transient failure; they return
        fewer organizations so one bad page never zeroes out a run.

        Parameters
        ----------
        term : str
            Free-text term to match against organization names.
        state : str
            Two-letter state code to scope the search to.
        limit : int
            Maximum organizations to return.

        Returns
        -------
        list[RegistryOrganization]
            Matching organizations, at most ``limit`` of them.
        """


class ProPublicaRegistryProvider(RegistryProvider):
    """Reads the IRS Form 990 index republished by ProPublica.

    No credential is required, which is the point: discovery keeps working
    when the search vendor refuses the account.
    """

    SEARCH_ENDPOINT = "https://projects.propublica.org/nonprofits/api/v2/search.json"
    ORGANIZATION_URL = "https://projects.propublica.org/nonprofits/organizations"
    PAGE_SIZE = 25

    def __init__(
        self,
        *,
        timeout: float = 20.0,
        user_agent: str = "AtlasBot/1.0 (+https://atlas.rebuildingus.org)",
    ) -> None:
        """Configure the ProPublica adapter.

        Parameters
        ----------
        timeout : float, optional
            Per-request timeout in seconds. Default is 20.0.
        user_agent : str, optional
            Identifier sent with each request, so the operator of a free
            public API can see who is calling and why.
        """
        self._timeout = timeout
        self._headers = {"Accept": "application/json", "User-Agent": user_agent}

    async def search_organizations(
        self,
        term: str,
        state: str,
        *,
        limit: int,
    ) -> list[RegistryOrganization]:
        """Page through ProPublica's search until ``limit`` is reached."""
        if limit <= 0:
            return []

        collected: list[RegistryOrganization] = []
        async with httpx.AsyncClient(timeout=self._timeout, headers=self._headers) as client:
            for page in range(self._pages_needed(limit)):
                payload = await self._fetch_page(client, term, state, page)
                if payload is None:
                    break
                organizations = payload.get("organizations") or []
                collected.extend(self._map_organization(raw) for raw in organizations)
                if len(organizations) < self.PAGE_SIZE:
                    break

        return collected[:limit]

    def _pages_needed(self, limit: int) -> int:
        """Return how many pages cover ``limit`` results."""
        return -(-limit // self.PAGE_SIZE)

    async def _fetch_page(
        self,
        client: httpx.AsyncClient,
        term: str,
        state: str,
        page: int,
    ) -> dict[str, object] | None:
        """Fetch one page, or None when the registry could not answer."""
        try:
            response = await client.get(
                self.SEARCH_ENDPOINT,
                params={"q": term, "state[id]": state, "page": page},
            )
            response.raise_for_status()
            decoded = response.json()
        except httpx.HTTPError as error:
            logger.warning(
                "Nonprofit registry page failed",
                extra={"term": term, "state": state, "page": page, "reason": type(error).__name__},
            )
            return None
        except ValueError:
            logger.warning(
                "Nonprofit registry returned a non-JSON page",
                extra={"term": term, "state": state, "page": page},
            )
            return None
        return decoded if isinstance(decoded, dict) else None

    def _map_organization(self, raw: dict[str, object]) -> RegistryOrganization:
        """Map one ProPublica search hit onto the shared registry shape."""
        ein = str(raw.get("ein") or "").strip()
        return RegistryOrganization(
            name=str(raw.get("name") or "").strip(),
            city=_optional_text(raw.get("city")),
            state=_optional_text(raw.get("state")),
            registry_id=ein,
            source_url=f"{self.ORGANIZATION_URL}/{ein}",
            category_code=_optional_text(raw.get("ntee_code")),
            website=_optional_text(raw.get("website")),
        )


def _optional_text(value: object) -> str | None:
    """Normalize a registry field to trimmed text, or None when absent."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def registry_terms_for_issue(search_terms: Sequence[str]) -> list[str]:
    """Pick the registry queries worth spending on an issue area.

    Registry search matches organization names rather than page text, so a
    phrase that reads naturally in an article ("housing crisis") matches no
    filer while the plain subject ("affordable housing") matches hundreds.
    Longer phrases are dropped for that reason.

    Parameters
    ----------
    search_terms : Sequence[str]
        The issue area's configured search terms.

    Returns
    -------
    list[str]
        Terms short enough to match a registered name, in the given order.
    """
    return [term for term in search_terms if len(term.split()) <= 3]
