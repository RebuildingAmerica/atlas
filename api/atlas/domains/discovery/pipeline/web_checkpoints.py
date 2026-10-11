"""Retain web evidence so an interrupted run does not lose completed research.

This is an opt-in web preparation stage, not a Durable Object alarm for the
whole pipeline. Registry lookup and publication still need durable boundaries.
Only serializable public-source outputs enter the database; clients and keys
remain invocation-owned. Each call performs at most one new provider unit.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import asdict
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, TypeVar

from atlas_shared import PageTaskOutcome, RawEntry
from pydantic import BaseModel, TypeAdapter

from atlas.domains.discovery.cost import (
    assert_within_budget,
    estimate_llm_cost,
    estimate_search_cost,
    record_cost,
)
from atlas.platform.database import db

from .crawl_checkpoints import advance_crawl
from .direct_sources import fetch_direct_source
from .extraction_checkpoints import advance_source_extraction
from .extractor import extract_entries
from .query_generator import generate_queries, sample_queries_across_categories
from .source_fetcher import FetchedSource, build_search_provider, fetch_sources

if TYPE_CHECKING:
    from aiosqlite import Connection

    from atlas.platform.config import Settings

    from .runner import DiscoveryPipelineCredentials, DiscoveryPipelineJob

_T = TypeVar("_T")
_UNIT_TIMEOUT_SECONDS = 120
_VERSION = 1


class CheckpointLeaseLostError(RuntimeError):
    """The caller no longer owns an active job lease."""

    def __init__(self) -> None:
        super().__init__("Discovery job lease is no longer owned by this worker.")


class CheckpointInputsChangedError(ValueError):
    """Prepared evidence cannot be reused with different research inputs."""

    def __init__(self) -> None:
        super().__init__("Discovery checkpoint inputs changed; a new run is required.")


class _Manifest(BaseModel):
    queries: list[str]
    started_at: datetime


class _SearchOutput(BaseModel):
    sources: list[FetchedSource]
    failure: str | None = None


class WebDiscovery(BaseModel):
    """Prepared web evidence consumed by the existing publication pipeline."""

    queries: list[str]
    sources: list[FetchedSource]
    entries: list[dict[str, Any]]
    search_failure: str | None
    started_at: datetime
    fingerprint: str
    page_tasks: list[PageTaskOutcome] | None = None


def web_checkpoint_fingerprint(
    job: DiscoveryPipelineJob,
    settings: Settings,
    *,
    bounded_extraction: bool = False,
    direct_urls: list[str] | None = None,
) -> str:
    """Bind prepared evidence to the exact run and its query cap."""
    return hashlib.sha256(
        json.dumps(
            {
                "version": _VERSION + 2 * int(bounded_extraction),
                "job": asdict(job),
                "queries": settings.discovery_max_queries_per_run,
                **({"direct_urls": direct_urls} if direct_urls is not None else {}),
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()


class _Checkpoints:
    def __init__(
        self, conn: Connection, job_id: str, owner: str, run_id: str, fingerprint: str
    ) -> None:
        self.conn = conn
        self.job_id = job_id
        self.owner = owner
        self.run_id = run_id
        self.fingerprint = fingerprint

    async def fence(self) -> None:
        # A short row lock fences writes against cancellation/reassignment.
        # No database transaction is held across external provider work.
        cursor = await self.conn.execute(
            "UPDATE discovery_jobs SET claimed_until = claimed_until "
            "WHERE id = ? AND run_id = ? AND claimed_by = ? "
            "AND status IN ('claimed', 'running') AND claimed_until > ?",
            (self.job_id, self.run_id, self.owner, db.now_iso()),
        )
        if cursor.rowcount != 1:
            await self.conn.execute("ROLLBACK")
            raise CheckpointLeaseLostError

    async def load(self, key: str, adapter: TypeAdapter[_T]) -> _T | None:
        await self.fence()
        cursor = await self.conn.execute(
            "SELECT fingerprint, result FROM discovery_web_checkpoints "
            "WHERE job_id = ? AND unit_key = ?",
            (self.job_id, key),
        )
        row = await cursor.fetchone()
        await self.conn.commit()
        if row is None:
            return None
        if row[0] != self.fingerprint:
            raise CheckpointInputsChangedError
        return adapter.validate_json(row[1])

    async def save(self, key: str, value: _T, adapter: TypeAdapter[_T]) -> None:
        await self.fence()
        await self.conn.execute(
            "INSERT INTO discovery_web_checkpoints (job_id, unit_key, fingerprint, result) "
            "VALUES (?, ?, ?, ?) ON CONFLICT (job_id, unit_key) DO UPDATE "
            "SET result = excluded.result WHERE discovery_web_checkpoints.fingerprint = excluded.fingerprint",
            (self.job_id, key, self.fingerprint, adapter.dump_json(value).decode()),
        )
        await self.conn.commit()

    async def reserve(self, *, kind: str, units: float, settings: Settings) -> None:
        await self.fence()
        try:
            await assert_within_budget(self.conn, run_id=self.run_id, settings=settings)
            # Meter BEFORE invoking the vendor. A crash may replay the unfinished
            # unit; every attempt is charged, including cancellation and timeouts.
            await record_cost(
                self.conn,
                run_id=self.run_id,
                kind=kind,
                provider="brave" if kind == "search" else "anthropic",
                units=units,
                estimated_cost=estimate_search_cost(units)
                if kind == "search"
                else estimate_llm_cost(units),
            )
        except BaseException:
            await self.conn.execute("ROLLBACK")
            raise


async def advance_web_discovery(  # noqa: PLR0913, PLR0912, PLR0915 - explicit resumable units
    conn: Connection,
    *,
    job_id: str,
    claimed_by: str,
    job: DiscoveryPipelineJob,
    settings: Settings,
    credentials: DiscoveryPipelineCredentials | None = None,
    bounded_extraction: bool = False,
    direct_urls: list[str] | None = None,
) -> WebDiscovery | None:
    """Perform one new web unit, returning evidence once preparation completes.

    Parameters
    ----------
    conn
        Invocation-owned connection with no unrelated pending transaction.
    job_id, claimed_by
        An active queue lease. Use a unique owner per invocation and renew the
        lease outside this function if needed; no process-local locks are used.
    job, settings, credentials
        Existing pipeline inputs. Credentials are never serialized.
    bounded_extraction
        Yield between individual model attempts instead of the original
        per-source extraction call. Used by the hosted continuation.
    direct_urls
        Explicit seeds, or None for generated search queries. Seed inputs are
        part of the checkpoint fingerprint and never consume search charges.

    Returns
    -------
    WebDiscovery | None
        All web evidence, or None when another invocation must continue.
        Each invocation performs at most one query (including its page fetches)
        or one source extraction, with a 120-second async deadline. CPU-bound
        parsing cannot be preempted by asyncio and still needs hosted proof.
    """
    city = job.location_query.split(",", maxsplit=1)[0].strip()
    fingerprint = web_checkpoint_fingerprint(
        job, settings, bounded_extraction=bounded_extraction, direct_urls=direct_urls
    )
    store = _Checkpoints(conn, job_id, claimed_by, job.run_id, fingerprint)
    manifest_adapter = TypeAdapter(_Manifest)
    manifest = await store.load("manifest", manifest_adapter)
    if manifest is None:
        manifest = _Manifest(
            queries=[]
            if direct_urls is not None or (not job.location_query and not job.issue_areas)
            else [
                query.query
                for query in sample_queries_across_categories(
                    generate_queries(city=city, state=job.state, issue_areas=job.issue_areas),
                    settings.discovery_max_queries_per_run,
                )
            ],
            started_at=datetime.now(UTC),
        )
        await store.save("manifest", manifest, manifest_adapter)

    sources: dict[str, FetchedSource] = {}
    failure = None
    advanced = False
    provider = build_search_provider(credentials.search_api_key if credentials else None)
    search_adapter = TypeAdapter(_SearchOutput)
    for index, query in enumerate(manifest.queries):
        key = f"search:{index}"
        output = await store.load(key, search_adapter)
        if output is None:
            if advanced:
                return None
            await store.reserve(kind="search", units=1, settings=settings)
            async with asyncio.timeout(_UNIT_TIMEOUT_SECONDS):
                fetched = await fetch_sources([query], provider)
            output = _SearchOutput(
                sources=fetched, failure=provider.last_failure_reason() if provider else None
            )
            await store.save(key, output, search_adapter)
            advanced = True
        failure = output.failure or failure
        for source in output.sources:
            sources.setdefault(source.url, source)

    page_tasks = None
    if bounded_extraction and direct_urls is not None:
        async with asyncio.timeout(_UNIT_TIMEOUT_SECONDS):
            crawl = await advance_crawl(store, seeds=direct_urls, settings=settings)
        if crawl is None:
            return None
        page_tasks = crawl.tasks
        for page in crawl.pages:
            sources.setdefault(
                page.url,
                FetchedSource(
                    page.url,
                    page.title,
                    page.publication,
                    page.published_date.isoformat() if page.published_date else None,
                    page.text,
                    page.source_type.value,
                    page.task_id,
                    page.discovered_links,
                    page.structured_data,
                ),
            )

    for index, url in enumerate([] if bounded_extraction else (direct_urls or [])):
        output = await store.load(f"direct:{index}", search_adapter)
        if output is None:
            if advanced:
                return None
            # HTTP fetches are not billable search/model calls, but the kill
            # switch and accumulated run/day ceilings still apply before I/O.
            await store.fence()
            try:
                await assert_within_budget(conn, run_id=job.run_id, settings=settings)
            except BaseException:
                await conn.execute("ROLLBACK")
                raise
            await conn.commit()
            async with asyncio.timeout(_UNIT_TIMEOUT_SECONDS):
                direct_source = await fetch_direct_source(url)
            output = _SearchOutput(sources=[direct_source] if direct_source else [])
            await store.save(f"direct:{index}", output, search_adapter)
            advanced = True
        for source in output.sources:
            sources.setdefault(source.url, source)

    entries: list[dict[str, Any]] = []
    entry_adapter = TypeAdapter(list[RawEntry])
    today = manifest.started_at.date().isoformat()
    for index, source in enumerate(sources.values()):
        key = f"extract:{index}"
        extracted = await store.load(key, entry_adapter)
        if extracted is None:
            if advanced:
                return None
            if bounded_extraction:
                extracted = await advance_source_extraction(
                    store=store,
                    index=index,
                    url=source.url,
                    content=source.content,
                    city=city,
                    state=job.state,
                    api_key=credentials.anthropic_api_key if credentials else None,
                    settings=settings,
                )
                if extracted is None:
                    return None
            else:
                await store.reserve(
                    kind="llm", units=float(len(source.content.split())), settings=settings
                )
                async with asyncio.timeout(_UNIT_TIMEOUT_SECONDS):
                    extracted = await extract_entries(
                        source.url,
                        source.content,
                        city,
                        job.state,
                        credentials.anthropic_api_key if credentials else None,
                    )
            await store.save(key, extracted, entry_adapter)
            advanced = True
        if page_tasks is not None:
            for task in page_tasks:
                if task.url == source.url:
                    task.status = "processed"
                    task.entries_extracted = len(extracted)
        source_date = (
            datetime.fromisoformat(source.published_date).date().isoformat()
            if source.published_date
            else today
        )
        for item in extracted:
            entry = item.model_dump(mode="json")
            entry.update(
                source_urls=[source.url],
                source_dates=[source_date],
                source_contexts={source.url: item.extraction_context},
                last_seen=source_date,
            )
            entries.append(entry)
    return WebDiscovery(
        queries=manifest.queries,
        sources=list(sources.values()),
        entries=entries,
        search_failure=failure,
        started_at=manifest.started_at,
        fingerprint=fingerprint,
        page_tasks=page_tasks,
    )
