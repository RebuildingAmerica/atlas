"""Retain registry and filing evidence between bounded provider operations.

The ordinary pipeline remains unchanged. This preparation path preserves term
order, first-EIN wins, hundred-organization filing batches, newest/prior return
selection, and the same role/source classification before publication.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import asdict, replace
from datetime import date
from typing import TYPE_CHECKING

from atlas_discovery_engine import registry_terms_for_issue
from atlas_discovery_engine.filing_checkpoints import FilingCheckpoint, advance_filing_lookup
from atlas_discovery_engine.filings import IrsFilingOfficerProvider, OrganizationFiling
from atlas_discovery_engine.registry import ProPublicaRegistryProvider, RegistryOrganization
from atlas_shared import PageContent
from pydantic import BaseModel, Field, TypeAdapter

from atlas.domains.discovery.resolution.mentions import PersonMention
from atlas.domains.discovery.resolution.register_mentions import (
    organization_mention,
    person_mentions,
)
from atlas.taxonomy.search_terms import ISSUE_SEARCH_TERMS

from .registry_stage import RegistryDiscovery
from .web_checkpoints import _Checkpoints

if TYPE_CHECKING:
    from aiosqlite import Connection

    from atlas.platform.config import Settings

    from .runner import DiscoveryPipelineJob

_UNIT_TIMEOUT_SECONDS = 120
_BATCH_SIZE = 100


class _RegistryState(BaseModel):
    terms: list[str]
    term_index: int = 0
    page: int = 0
    term_budget: int | None = None
    term_rows: list[RegistryOrganization] = Field(default_factory=list)
    rows: list[RegistryOrganization] = Field(default_factory=list)
    batch_start: int = 0
    filing_progress: FilingCheckpoint | None = None
    filings: list[OrganizationFiling] = Field(default_factory=list)
    raw_people: int = 0
    filing_index: int = 0
    officer_index: int = 0
    people: list[PersonMention] = Field(default_factory=list)


_RegistryState.model_rebuild(
    _types_namespace={"date": date, "PageContent": PageContent, "PersonMention": PersonMention}
)


def _fingerprint(job: DiscoveryPipelineJob, settings: Settings, today: date) -> str:
    return hashlib.sha256(
        json.dumps(
            {
                "version": 1,
                "job": asdict(job),
                "today": today.isoformat(),
                "organizations": settings.discovery_registry_max_organizations,
                "people": settings.discovery_registry_max_people,
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()


async def advance_registry_discovery(  # noqa: PLR0913
    conn: Connection,
    *,
    job_id: str,
    claimed_by: str,
    job: DiscoveryPipelineJob,
    settings: Settings,
    today: date,
) -> RegistryDiscovery | None:
    """Complete at most one new registry/filing operation or officer classification.

    Parameters
    ----------
    conn
        Invocation-owned connection without unrelated pending writes.
    job_id, claimed_by
        Active job lease with a unique owner for the current invocation.
    job, settings, today
        Frozen research inputs, budgets and evidence date. A changed input fails
        rather than mixing different research or silently changing role currency.

    Returns
    -------
    RegistryDiscovery | None
        Typed evidence once complete, otherwise None for a deliberate yield.
        Publication, queue scheduling and lease release remain caller-owned.
        A directory/member is one bounded provider operation, not a guarantee
        about its synchronous parse CPU or memory; hosted acceptance is required.
    """
    store = _Checkpoints(conn, job_id, claimed_by, job.run_id, _fingerprint(job, settings, today))
    codec = TypeAdapter(_RegistryState)
    state = await store.load("registry:progress", codec)
    if state is None:
        state = _RegistryState(
            terms=[
                term
                for issue in job.issue_areas
                for term in registry_terms_for_issue(ISSUE_SEARCH_TERMS.get(issue, ()))
            ]
        )
    organization_limit, people_limit = (
        settings.discovery_registry_max_organizations,
        settings.discovery_registry_max_people,
    )
    if len(state.rows) < organization_limit and state.term_index < len(state.terms):
        provider = ProPublicaRegistryProvider()
        budget = state.term_budget or organization_limit - len(state.rows)
        async with asyncio.timeout(_UNIT_TIMEOUT_SECONDS):
            page = await provider.search_page(
                state.terms[state.term_index], job.state, page=state.page
            )
        state.term_budget = budget
        state.term_rows.extend(page.organizations[: max(0, budget - len(state.term_rows))])
        state.page += 1
        # Match the original raw-result page budget before deduplicating EINs.
        if not page.has_more or state.page * ProPublicaRegistryProvider.PAGE_SIZE >= budget:
            seen = {row.registry_id: row for row in state.rows}
            for row in state.term_rows:
                if row.registry_id:
                    seen.setdefault(row.registry_id, row)
            state.rows = list(seen.values())[:organization_limit]
            state.term_index += 1
            state.page = 0
            state.term_budget = None
            state.term_rows = []
        await store.save("registry:progress", state, codec)
        return None

    organizations = {
        mention.ein: mention
        for row in state.rows
        if (mention := organization_mention(row)) is not None
    }
    named = [row for row in state.rows if row.registry_id in organizations]
    if people_limit > state.raw_people and state.batch_start < len(named):
        progress = state.filing_progress or FilingCheckpoint(
            eins=tuple(
                row.registry_id
                for row in named[state.batch_start : state.batch_start + _BATCH_SIZE]
            )
        )
        async with asyncio.timeout(_UNIT_TIMEOUT_SECONDS):
            progress = await advance_filing_lookup(IrsFilingOfficerProvider(), progress)
        if progress.done:
            state.filings.extend(progress.filings)
            state.raw_people += sum(len(filing.officers) for filing in progress.filings)
            state.batch_start += _BATCH_SIZE
            state.filing_progress = None
        else:
            state.filing_progress = progress
        await store.save("registry:progress", state, codec)
        return None

    while len(state.people) < people_limit and state.filing_index < len(state.filings):
        filing = state.filings[state.filing_index]
        if state.officer_index >= len(filing.officers):
            state.filing_index += 1
            state.officer_index = 0
            continue
        officer = filing.officers[state.officer_index]
        state.people.extend(
            person_mentions(
                organizations[filing.ein], replace(filing, officers=(officer,)), today=today
            )
        )
        state.officer_index += 1
        await store.save("registry:progress", state, codec)
        return None
    # Persist even a zero-budget/empty run so changed inputs cannot reuse it.
    await store.save("registry:progress", state, codec)
    return RegistryDiscovery(organizations=list(organizations.values()), people=state.people)
