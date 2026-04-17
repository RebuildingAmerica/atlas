"""Async HTTP fetcher with shared clients, work claims, and tracked outcomes."""

from __future__ import annotations

import asyncio
import importlib.util
import logging
from datetime import datetime
from typing import TYPE_CHECKING, Any

import httpx
from atlas_shared import PageContent, SourceType

from atlas_scout.scraper.extractor import ContentExtraction, extract_content_verbose

if TYPE_CHECKING:
    from atlas_scout.store import ScoutStore

logger = logging.getLogger(__name__)

USER_AGENT = "AtlasScout/1.0 (+https://atlas.rebuilding.us/scout)"
_CLAIM_POLL_SECONDS = 0.25


class AsyncFetcher:
    """Async HTTP fetcher with concurrency limiting, shared cache, and detailed outcomes."""

    def __init__(
        self,
        max_concurrent: int = 20,
        request_delay_ms: int = 200,
        timeout: float = 30.0,
        page_cache_ttl_days: int = 7,
        store: ScoutStore | None = None,
        revisit_cached_urls: bool = False,
        force_refresh: bool = False,
        run_id: str | None = None,
    ) -> None:
        """Configure concurrency, delays, and cache refresh policy."""
        self._max_concurrent = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._delay = request_delay_ms / 1000.0
        self._timeout = timeout
        self._cache_ttl = page_cache_ttl_days
        self._store = store
        self._revisit_cached_urls = revisit_cached_urls
        self._force_refresh = force_refresh
        self._run_id = run_id or "anonymous"
        self._client = httpx.AsyncClient(
            timeout=self._timeout,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
            http2=importlib.util.find_spec("h2") is not None,
        )

    def bind_run(self, run_id: str) -> None:
        """Attach the current pipeline run ID for shared fetch claims."""
        self._run_id = run_id

    @property
    def max_concurrent(self) -> int:
        """Return the configured fetch concurrency."""
        return self._max_concurrent

    async def close(self) -> None:
        """Close the shared HTTP client."""
        await self._client.aclose()

    async def fetch(self, url: str) -> PageContent | None:
        """Fetch a URL and return extracted page content when available."""
        outcome = await self.fetch_tracked_verbose(url, task_id="", _store=self._store)
        return outcome["page"]

    async def fetch_tracked(
        self,
        url: str,
        task_id: str,
        _store: ScoutStore | None,
    ) -> PageContent | None:
        """Fetch a URL and stamp the current page-task ID on the result."""
        outcome = await self.fetch_tracked_verbose(url, task_id=task_id, _store=_store)
        return outcome["page"]

    async def fetch_tracked_verbose(
        self,
        url: str,
        task_id: str,
        _store: ScoutStore | None,
    ) -> dict[str, Any]:
        """Fetch a URL and return a structured outcome for pipeline progress/reporting."""
        cache_hit, cached = await self._get_cached_outcome(url, task_id)
        if cache_hit:
            return cached

        if self._store is None:
            return await self._fetch_network(url, task_id)

        claim_key = f"fetch:{url}"
        deadline = asyncio.get_running_loop().time() + max(self._timeout, 30.0)

        while True:
            if await self._store.claim_work(claim_key, owner_run_id=self._run_id):
                try:
                    outcome = await self._fetch_network(url, task_id)
                except Exception as exc:
                    await self._store.fail_work(claim_key, str(exc))
                    raise
                await self._store.complete_work(claim_key)
                return outcome

            cache_hit, cached = await self._get_cached_outcome(url, task_id)
            if cache_hit:
                return cached

            claim = await self._store.get_work_claim(claim_key)
            if claim is None or claim.get("status") != "inflight":
                continue
            if asyncio.get_running_loop().time() >= deadline:
                logger.debug("Timed out waiting on shared fetch claim for %s", url)
                return self._make_outcome(
                    url=url,
                    task_id=task_id,
                    page=None,
                    status="filtered",
                    error="shared_fetch_timeout",
                    discovered_links=[],
                )
            await asyncio.sleep(_CLAIM_POLL_SECONDS)

    async def fetch_many(self, urls: list[str]) -> list[PageContent]:
        """Fetch many URLs concurrently and return successful page results."""
        tasks = [self.fetch(url) for url in urls]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return [result for result in results if isinstance(result, PageContent)]

    async def _fetch_network(self, url: str, task_id: str) -> dict[str, Any]:
        """Fetch one URL from the network and persist a reusable outcome."""
        async with self._semaphore:
            if self._delay > 0:
                await asyncio.sleep(self._delay)
            try:
                response = await self._client.get(url)
                response.raise_for_status()
            except (httpx.HTTPStatusError, httpx.RequestError) as exc:
                reason = self._error_reason(exc)
                logger.debug("Failed to fetch %s: %s", url, exc)
                await self._cache_negative_result(url, reason=reason, discovered_links=[])
                return self._make_outcome(
                    url=url,
                    task_id=task_id,
                    page=None,
                    status="filtered",
                    error=reason,
                    discovered_links=[],
                )

            content_type = response.headers.get("content-type", "")
            if "application/pdf" in content_type:
                extracted = _extract_pdf_content(response.content, url=url)
            else:
                extracted = extract_content_verbose(response.text, url=url)
            if extracted.page is None:
                reason = extracted.reason or "content_not_extractable"
                await self._cache_negative_result(
                    url,
                    reason=reason,
                    discovered_links=extracted.discovered_links,
                )
                return self._make_outcome(
                    url=url,
                    task_id=task_id,
                    page=None,
                    status="filtered",
                    error=reason,
                    discovered_links=extracted.discovered_links,
                )

            page = extracted.page.model_copy(
                update={
                    "task_id": task_id or extracted.page.task_id,
                    "discovered_links": extracted.discovered_links,
                }
            )
            await self._cache_positive_result(page)
            return self._make_outcome(
                url=url,
                task_id=task_id,
                page=page,
                status="fetched",
                error=None,
                discovered_links=extracted.discovered_links,
            )

    async def _get_cached_outcome(
        self,
        url: str,
        task_id: str,
    ) -> tuple[bool, dict[str, Any]]:
        """Return ``(cache_hit, outcome)`` for cached positive or negative fetch results."""
        if self._store is None or self._force_refresh:
            return False, {}

        ttl_days: int | None = self._cache_ttl if self._revisit_cached_urls else None
        cached = await self._store.get_cached_page(url, ttl_days=ttl_days)
        if cached is None:
            return False, {}

        metadata = cached["metadata"]
        discovered_links = _coerce_discovered_links(metadata.get("discovered_links"))
        status = str(metadata.get("status") or "fetched")
        reason = metadata.get("reason")

        text = cached.get("text") or ""
        if status == "fetched" and text.strip():
            page = PageContent(
                url=url,
                text=text,
                title=str(metadata.get("title") or ""),
                task_id=task_id or None,
                discovered_links=discovered_links,
                publication=metadata.get("publication"),
                published_date=_parse_cached_datetime(metadata.get("published_date")),
                source_type=_parse_source_type(metadata.get("source_type")),
            )
            return True, self._make_outcome(
                url=url,
                task_id=task_id,
                page=page,
                status="fetched",
                error=None,
                discovered_links=discovered_links,
            )

        return True, self._make_outcome(
            url=url,
            task_id=task_id,
            page=None,
            status=status,
            error=str(reason) if reason else None,
            discovered_links=discovered_links,
        )

    async def _cache_positive_result(self, page: PageContent) -> None:
        """Persist a successfully fetched page outcome."""
        if self._store is None:
            return
        await self._store.cache_page(
            page.url,
            page.text,
            {
                "status": "fetched",
                "reason": None,
                "title": page.title,
                "publication": page.publication,
                "published_date": page.published_date.isoformat()
                if page.published_date
                else None,
                "source_type": str(page.source_type),
                "discovered_links": page.discovered_links,
            },
        )

    async def _cache_negative_result(
        self,
        url: str,
        *,
        reason: str,
        discovered_links: list[str],
    ) -> None:
        """Persist a negative fetch outcome so future runs skip duplicate work by default."""
        if self._store is None:
            return
        await self._store.cache_page(
            url,
            "",
            {
                "status": "filtered",
                "reason": reason,
                "title": "",
                "publication": None,
                "published_date": None,
                "source_type": str(SourceType.WEBSITE),
                "discovered_links": discovered_links,
            },
        )

    @staticmethod
    def _make_outcome(
        *,
        url: str,
        task_id: str,
        page: PageContent | None,
        status: str,
        error: str | None,
        discovered_links: list[str],
    ) -> dict[str, Any]:
        """Build the normalized fetch outcome used by the pipeline."""
        return {
            "url": url,
            "task_id": task_id,
            "page": page,
            "status": status,
            "error": error,
            "discovered_links": discovered_links,
        }

    @staticmethod
    def _error_reason(exc: Exception) -> str:
        """Return a stable reason code for a failed request."""
        if isinstance(exc, httpx.HTTPStatusError):
            return f"http_{exc.response.status_code}"
        if isinstance(exc, httpx.ConnectError):
            return "connect_error"
        if isinstance(exc, httpx.TimeoutException):
            return "timeout"
        return "request_error"


def _parse_cached_datetime(value: Any) -> datetime | None:
    """Parse cached ISO datetimes back into ``datetime`` objects."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def _parse_source_type(value: Any) -> SourceType:
    """Parse a stored source type string back into the enum."""
    if isinstance(value, SourceType):
        return value
    if isinstance(value, str):
        try:
            return SourceType(value)
        except ValueError:
            return SourceType.WEBSITE
    return SourceType.WEBSITE


def _coerce_discovered_links(value: Any) -> list[str]:
    """Normalize cached discovered-link metadata into a string list."""
    if isinstance(value, list):
        return [str(item) for item in value if str(item)]
    return []


def _extract_pdf_content(data: bytes, *, url: str) -> ContentExtraction:
    """Extract text from PDF bytes using pymupdf if available, otherwise skip."""
    try:
        import pymupdf  # noqa: PLC0415
    except ImportError:
        logger.debug("pymupdf not installed — skipping PDF: %s", url)
        return ContentExtraction(page=None, reason="pdf_extraction_unavailable", discovered_links=[])

    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
        pages_text = [page.get_text() for page in doc]
        text = "\n\n".join(pages_text).strip()
        title = doc.metadata.get("title", "") or ""
        doc.close()
    except Exception as exc:
        logger.debug("PDF extraction failed for %s: %s", url, exc)
        return ContentExtraction(page=None, reason="pdf_extraction_failed", discovered_links=[])

    from atlas_scout.scraper.extractor import content_quality_reason  # noqa: PLC0415

    quality_reason = content_quality_reason(text) if text else "content_below_min_words"
    if quality_reason is not None:
        return ContentExtraction(page=None, reason=quality_reason, discovered_links=[])

    return ContentExtraction(
        page=PageContent(
            url=url,
            text=text,
            title=title,
            source_type=SourceType.REPORT,
        ),
        reason=None,
        discovered_links=[],
    )
