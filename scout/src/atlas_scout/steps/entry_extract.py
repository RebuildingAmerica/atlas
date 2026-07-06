"""Step 3: Entry Extraction with streaming concurrency and durable caching."""

from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import logging
import re
from typing import TYPE_CHECKING, Annotated, Any
from urllib.parse import urlparse

from atlas_shared import ISSUE_AREAS_BY_DOMAIN, PageContent, RawEntry
from pydantic import BaseModel, BeforeValidator, Field

from atlas_scout.providers.base import Completion, LLMProvider, Message
from atlas_scout.steps.validate import validate_entries

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable

    from atlas_scout.store import ScoutStore

logger = logging.getLogger(__name__)

__all__ = ["extract_entries_stream", "extract_page_entries"]

_CLAIM_POLL_SECONDS = 0.25
_CLAIM_LEASE_SECONDS = 60.0
_CLAIM_WAIT_SECONDS = 60.0
_MAX_EXTRACTION_ATTEMPTS = 5
_RETRY_BACKOFF_SECONDS = 1.0
_ROSTER_PARTY_LABELS = {"democrat", "democratic", "republican", "independent"}
_BOROUGH_LABELS = {"manhattan", "bronx", "queens", "brooklyn", "staten island"}
_SENATE_CONTACT_HEADER_RE = re.compile(r"^(?P<label>.+) \((?P<party>[A-Z])-(?P<state>[A-Z]{2})\)$")
_STRUCTURED_NAME_TITLE_KEYS = {
    "chair",
    "councilmember",
    "delegate",
    "dr",
    "gov",
    "governor",
    "hon",
    "judge",
    "mayor",
    "miss",
    "mr",
    "mrs",
    "ms",
    "rep",
    "representative",
    "rev",
    "sen",
    "senator",
    "speaker",
}
_STRUCTURED_NAME_CREDENTIAL_KEYS = {"dd", "do", "esq", "jd", "md", "phd"}
_STRUCTURED_NAME_CREDENTIAL_SEQUENCES = (
    ("p", "h", "d"),
    ("d", "d"),
    ("d", "o"),
    ("j", "d"),
    ("m", "d"),
)
_STRUCTURED_NAME_SUFFIX_LABELS = {
    "ii": "II",
    "iii": "III",
    "iv": "IV",
    "jr": "Jr.",
    "sr": "Sr.",
    "v": "V",
}


class ExtractionFailedError(RuntimeError):
    """Raised when a page could not be extracted due to provider/output failure."""


def _coerce_dict(v: dict[str, str] | None) -> dict[str, str]:
    return v if v is not None else {}


def _coerce_str_list(v: list[str] | None) -> list[str]:
    return v if v is not None else []


def _coerce_mention_list(v: list[dict[str, str]] | None) -> list[dict[str, str]]:
    return v if v is not None else []


class _StructuredExtractionItem(BaseModel):
    """Schema for one extracted Atlas entry — tolerant of null fields from LLMs."""

    name: str
    type: str
    description: str = ""
    city: str | None = None
    state: str | None = None
    geo_specificity: str = "local"
    issue_areas: Annotated[list[str], BeforeValidator(_coerce_str_list)] = Field(
        default_factory=list
    )
    region: str | None = None
    website: str | None = None
    email: str | None = None
    social_media: Annotated[dict[str, str], BeforeValidator(_coerce_dict)] = Field(
        default_factory=dict
    )
    affiliated_org: str | None = None
    extraction_context: str = ""
    mentioned_entities: Annotated[list[dict[str, str]], BeforeValidator(_coerce_mention_list)] = (
        Field(default_factory=list)
    )


class _StructuredExtractionResponse(BaseModel):
    """Strict structured-output envelope for extraction responses."""

    entries: list[_StructuredExtractionItem] = Field(default_factory=list)
    discovery_leads: list[str] = Field(default_factory=list)


async def extract_entries_stream(
    pages: AsyncIterator[PageContent],
    provider: LLMProvider,
    city: str,
    state: str,
    *,
    store: ScoutStore | None = None,
    run_id: str | None = None,
    reuse_cached_extractions: bool = True,
    extraction_directive: str | None = None,
    on_retry: Callable[[dict[str, object]], None] | None = None,
) -> AsyncIterator[RawEntry]:
    """
    Extract structured entries from page content using an LLM provider.

    Pages are processed with bounded concurrency and extraction results are
    cached by content fingerprint, prompt, and provider identity so repeated
    runs can reuse prior work.
    """
    pending: set[asyncio.Task[list[RawEntry]]] = set()

    async def _extract_page(page: PageContent) -> list[RawEntry]:
        """Run extraction for one page, using shared caches when possible."""
        return await extract_page_entries(
            page,
            provider,
            city,
            state,
            store=store,
            run_id=run_id,
            reuse_cached_extractions=reuse_cached_extractions,
            extraction_directive=extraction_directive,
            on_retry=on_retry,
        )

    async for page in pages:
        task = asyncio.create_task(_extract_page(page))
        pending.add(task)
        if len(pending) >= provider.max_concurrent:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for task_done in done:
                entries = await task_done
                for entry in entries:
                    yield entry

    while pending:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        for task_done in done:
            entries = await task_done
            for entry in entries:
                yield entry


async def extract_page_entries(
    page: PageContent,
    provider: LLMProvider,
    city: str,
    state: str,
    *,
    store: ScoutStore | None,
    run_id: str | None,
    reuse_cached_extractions: bool,
    extraction_directive: str | None = None,
    on_retry: Callable[[dict[str, object]], None] | None = None,
) -> list[RawEntry]:
    """Extract entries for a single page, using durable caches and work claims."""
    if not page.text.strip():
        return []

    system_prompt = _build_system_prompt(city, state, extraction_directive=extraction_directive)
    prompt_key = _prompt_key(system_prompt)
    provider_key = _provider_cache_key(provider)
    source_fingerprint = _page_fingerprint(page)
    cache_key = _extraction_cache_key(
        source_fingerprint=source_fingerprint,
        provider_key=provider_key,
        prompt_key=prompt_key,
    )

    if store is not None and reuse_cached_extractions:
        cached = await store.get_cached_extraction(cache_key)
        if cached is not None:
            return _entries_from_cached(cached["entries"], source_url=page.url)

    if store is not None:
        claim_key = f"extract:{cache_key}"
        owner_run_id = run_id or "anonymous"
        deadline = asyncio.get_running_loop().time() + _CLAIM_WAIT_SECONDS

        while True:
            if await store.claim_work(
                claim_key,
                owner_run_id=owner_run_id,
                lease_seconds=int(_CLAIM_LEASE_SECONDS),
            ):
                return await _perform_extraction(
                    page,
                    provider,
                    city=city,
                    state=state,
                    system_prompt=system_prompt,
                    source_fingerprint=source_fingerprint,
                    provider_key=provider_key,
                    prompt_key=prompt_key,
                    cache_key=cache_key,
                    store=store,
                    claim_key=claim_key,
                    on_retry=on_retry,
                )

            if reuse_cached_extractions:
                cached = await store.get_cached_extraction(cache_key)
                if cached is not None:
                    return _entries_from_cached(cached["entries"], source_url=page.url)

            claim = await store.get_work_claim(claim_key)
            if claim is None or claim.get("status") != "inflight":
                continue
            if asyncio.get_running_loop().time() >= deadline:
                logger.warning(
                    "Timed out waiting on shared extraction claim for %s; falling back to local extraction",
                    page.url,
                )
                return await _perform_unclaimed_extraction(
                    page,
                    provider,
                    city=city,
                    state=state,
                    system_prompt=system_prompt,
                    source_fingerprint=source_fingerprint,
                    provider_key=provider_key,
                    prompt_key=prompt_key,
                    cache_key=cache_key,
                    store=store,
                    on_retry=on_retry,
                )
            await asyncio.sleep(_CLAIM_POLL_SECONDS)
    return await _run_provider_extraction(
        page,
        provider,
        city=city,
        state=state,
        system_prompt=system_prompt,
        on_retry=on_retry,
    )


async def _perform_extraction(
    page: PageContent,
    provider: LLMProvider,
    *,
    city: str,
    state: str,
    system_prompt: str,
    source_fingerprint: str,
    provider_key: str,
    prompt_key: str,
    cache_key: str,
    store: ScoutStore,
    claim_key: str,
    on_retry: Callable[[dict[str, object]], None] | None,
) -> list[RawEntry]:
    """Run provider extraction, persist the cache, and release the claim."""
    try:
        entries = await _run_provider_extraction(
            page,
            provider,
            city=city,
            state=state,
            system_prompt=system_prompt,
            on_retry=on_retry,
        )
        await store.cache_extraction(
            cache_key=cache_key,
            source_fingerprint=source_fingerprint,
            provider_key=provider_key,
            prompt_key=prompt_key,
            entries=[_cacheable_entry(entry) for entry in entries],
        )
        await store.complete_work(claim_key)
        return entries
    except Exception as exc:
        logger.warning("Extraction failed for %s: %s", page.url, _error_reason(exc))
        await store.fail_work(claim_key, _error_reason(exc))
        raise


async def _perform_unclaimed_extraction(
    page: PageContent,
    provider: LLMProvider,
    *,
    city: str,
    state: str,
    system_prompt: str,
    source_fingerprint: str,
    provider_key: str,
    prompt_key: str,
    cache_key: str,
    store: ScoutStore,
    on_retry: Callable[[dict[str, object]], None] | None,
) -> list[RawEntry]:
    """Run extraction without owning the shared claim, then update cache opportunistically."""
    entries = await _run_provider_extraction(
        page,
        provider,
        city=city,
        state=state,
        system_prompt=system_prompt,
        on_retry=on_retry,
    )
    await store.cache_extraction(
        cache_key=cache_key,
        source_fingerprint=source_fingerprint,
        provider_key=provider_key,
        prompt_key=prompt_key,
        entries=[_cacheable_entry(entry) for entry in entries],
    )
    return entries


async def _run_provider_extraction(
    page: PageContent,
    provider: LLMProvider,
    *,
    city: str,
    state: str,
    system_prompt: str,
    on_retry: Callable[[dict[str, object]], None] | None = None,
) -> list[RawEntry]:
    """Two-pass extraction: identify entities, then enrich each one.

    Pass 1 asks a simple question: "Who and what is named in this text?"
    Pass 2 takes each identified entity and extracts structured details.

    This decomposition lets any model succeed — each call has one focused job.
    """
    structured_entries = _extract_structured_resource_entries(page, city=city, state=state)
    if structured_entries:
        return structured_entries
    roster_entries = _extract_roster_table_entries(page, city=city, state=state)
    if roster_entries:
        return roster_entries
    tabular_roster_entries = _extract_tabular_roster_entries(page, city=city, state=state)
    if tabular_roster_entries:
        return tabular_roster_entries
    senate_entries = _extract_senate_contact_entries(page, city=city, state=state)
    if senate_entries:
        return senate_entries
    member_list_entries = _extract_member_list_entries(page, city=city, state=state)
    if member_list_entries:
        return member_list_entries
    state_senate_entries = _extract_state_senate_entries(page, city=city, state=state)
    if state_senate_entries:
        return state_senate_entries
    line_delimited_entries = _extract_line_delimited_roster_entries(
        page,
        city=city,
        state=state,
    )
    if line_delimited_entries:
        return line_delimited_entries
    plain_table_entries = _extract_plain_text_roster_table_entries(
        page,
        city=city,
        state=state,
    )
    if plain_table_entries:
        return plain_table_entries
    office_roster_entries = _extract_plain_text_office_roster_entries(
        page,
        city=city,
        state=state,
    )
    if office_roster_entries:
        return office_roster_entries

    # --- Pass 1: Identify all named entities ---
    identified = await _pass_identify(page, provider, on_retry=on_retry)
    if not identified:
        return []

    # --- Pass 2: Enrich each entity with structured details ---
    entries = await _pass_enrich(
        identified,
        page,
        provider,
        system_prompt=system_prompt,
        on_retry=on_retry,
    )
    entries = _validate_against_source(entries, page)
    page_date = page.published_date.date() if page.published_date else None
    for entry in entries:
        if city and not entry.city:
            entry.city = city
        if state and not entry.state:
            entry.state = state
        entry.source_url = page.url
        entry.source_date = page_date
    return entries


def _extract_roster_table_entries(page: PageContent, *, city: str, state: str) -> list[RawEntry]:
    """Extract public-office roster rows from markdown-like tables."""
    entries: list[RawEntry] = []
    name_index: int | None = None
    district_index: int | None = None
    party_index: int | None = None
    source_date = page.published_date.date() if page.published_date else None

    for line in page.text.splitlines():
        row = line.strip()
        if not row.startswith("|") or not row.endswith("|"):
            continue

        cells = _split_markdown_table_row(row)
        if not cells or _is_markdown_separator_row(cells):
            continue

        normalized_cells = [cell.strip().lower() for cell in cells]
        header_name_index = _roster_name_column_index(normalized_cells)
        if header_name_index is not None and _looks_like_roster_header(normalized_cells):
            name_index = header_name_index
            district_index = _optional_cell_index(normalized_cells, "district")
            party_index = _optional_cell_index(normalized_cells, "party")
            continue

        if _looks_like_numbered_roster_row(cells):
            district = cells[0].strip()
            name = _normalize_roster_name(_strip_civic_title_prefix(cells[1]))
            jurisdiction = cells[2].strip()
            party = cells[3].strip()
            entries.append(
                RawEntry(
                    name=name,
                    entry_type="person",
                    description=(
                        f"{name} is listed as a public officeholder for District {district} "
                        f"in {jurisdiction} with party marker {party}."
                    ),
                    city=city or None,
                    state=state or None,
                    geo_specificity="local",
                    issue_areas=["local_government_and_civic_engagement"],
                    website=page.url,
                    affiliated_org=_affiliated_org_from_url(page.url),
                    extraction_context=row,
                    source_url=page.url,
                    source_date=source_date,
                )
            )
            continue

        if name_index is None or name_index >= len(cells):
            continue

        name = _normalize_roster_name(cells[name_index])
        if not name:
            continue

        district = _cell_at(cells, district_index)
        party = _cell_at(cells, party_index)
        description_parts = [f"{name} is listed as a public officeholder"]
        if district:
            description_parts.append(f"for {district}")
        if party:
            description_parts.append(f"with party marker {party}")
        description_parts.append("in the source roster.")

        entries.append(
            RawEntry(
                name=name,
                entry_type="person",
                description=" ".join(description_parts),
                city=city or None,
                state=state or None,
                geo_specificity="local",
                issue_areas=[
                    "political_polarization_and_democratic_norms",
                    "electoral_reform",
                ],
                website=page.url,
                affiliated_org=_affiliated_org_from_url(page.url),
                extraction_context=row,
                source_url=page.url,
                source_date=source_date,
            )
        )

    return entries


def _extract_senate_contact_entries(page: PageContent, *, city: str, state: str) -> list[RawEntry]:
    """Extract senators from senate.gov contact XML rendered as line blocks."""
    entries: list[RawEntry] = []
    source_date = page.published_date.date() if page.published_date else None
    lines = [line.strip() for line in page.text.splitlines() if line.strip()]

    for index, line in enumerate(lines):
        match = _SENATE_CONTACT_HEADER_RE.match(line)
        if match is None or index + 8 >= len(lines):
            continue

        last_name = lines[index + 1]
        first_name = lines[index + 2]
        party = lines[index + 3]
        state_code = lines[index + 4]
        phone = lines[index + 6]
        website = lines[index + 8]
        if party != match.group("party") or state_code != match.group("state"):
            continue
        if not website.startswith("http"):
            continue

        name = f"{first_name} {last_name}".strip()
        context = "\n".join(lines[index : index + 9])
        entries.append(
            RawEntry(
                name=name,
                entry_type="person",
                description=(
                    f"{name} is listed as a United States senator for {state_code} "
                    f"with party marker {party} and phone {phone} in the Senate contact roster."
                ),
                city=city or None,
                state=state_code or state or None,
                geo_specificity="statewide",
                issue_areas=[
                    "political_polarization_and_democratic_norms",
                    "electoral_reform",
                ],
                website=website,
                affiliated_org="United States Senate",
                extraction_context=context,
                source_url=page.url,
                source_date=source_date,
            )
        )

    return entries


def _extract_member_list_entries(page: PageContent, *, city: str, state: str) -> list[RawEntry]:
    """Extract state legislative members from repeated plain-text list blocks."""
    entries: list[RawEntry] = []
    source_date = page.published_date.date() if page.published_date else None
    lines = [line.strip() for line in page.text.splitlines() if line.strip()]

    for index, line in enumerate(lines):
        if line != "-" or index + 3 >= len(lines):
            continue

        name = _normalize_roster_name(lines[index + 1])
        district_line = lines[index + 2]
        party = lines[index + 3]
        if not name or not district_line.lower().startswith("district:"):
            continue
        if party.lower() not in _ROSTER_PARTY_LABELS:
            continue

        district = district_line.split(":", maxsplit=1)[1].strip()
        context = "\n".join(lines[index : index + 4])
        entries.append(
            RawEntry(
                name=name,
                entry_type="person",
                description=(
                    f"{name} is listed as a state legislative member for District {district} "
                    f"with party marker {party} in the official member roster."
                ),
                city=city or None,
                state=state or None,
                geo_specificity="statewide",
                issue_areas=[
                    "political_polarization_and_democratic_norms",
                    "electoral_reform",
                ],
                website=page.url,
                affiliated_org=_affiliated_org_from_url(page.url),
                extraction_context=context,
                source_url=page.url,
                source_date=source_date,
            )
        )

    return entries


def _extract_state_senate_entries(page: PageContent, *, city: str, state: str) -> list[RawEntry]:
    """Extract state senators from plain-text blocks with party office markers."""
    entries: list[RawEntry] = []
    source_date = page.published_date.date() if page.published_date else None
    lines = [line.strip() for line in page.text.splitlines() if line.strip()]

    for index, line in enumerate(lines[1:], start=1):
        if line not in {"(D)Capitol Office", "(R)Capitol Office", "(I)Capitol Office"}:
            continue

        name = _normalize_roster_name(lines[index - 1])
        if not name:
            continue

        party = line[1]
        context = "\n".join(lines[index - 1 : min(index + 3, len(lines))])
        entries.append(
            RawEntry(
                name=name,
                entry_type="person",
                description=(
                    f"{name} is listed as a state senator with party marker {party} "
                    "and Capitol Office contact details in the official Senate roster."
                ),
                city=city or None,
                state=state or None,
                geo_specificity="statewide",
                issue_areas=[
                    "political_polarization_and_democratic_norms",
                    "electoral_reform",
                ],
                website=page.url,
                affiliated_org=_affiliated_org_from_url(page.url),
                extraction_context=context,
                source_url=page.url,
                source_date=source_date,
            )
        )

    return entries


def _extract_line_delimited_roster_entries(
    page: PageContent,
    *,
    city: str,
    state: str,
) -> list[RawEntry]:
    """Extract rosters scraped as repeated pipe-delimited line blocks."""
    entries: list[RawEntry] = []
    source_date = page.published_date.date() if page.published_date else None
    lines = [line.strip() for line in page.text.splitlines() if line.strip()]
    index = 0

    while index + 5 < len(lines):
        if _clean_pipe_cell(lines[index]) != "" or _clean_pipe_cell(lines[index + 2]) != "":
            index += 1
            continue

        name = _normalize_roster_name(lines[index + 1])
        district = _clean_pipe_cell(lines[index + 3])
        term = _clean_pipe_cell(lines[index + 4])
        party = _clean_pipe_cell(lines[index + 5])
        if (
            not name
            or re.fullmatch(r"\d+[A-Za-z]?", district) is None
            or " to " not in term
            or party.lower() not in _ROSTER_PARTY_LABELS
        ):
            index += 1
            continue

        context = "\n".join(lines[index : index + 6])
        entries.append(
            RawEntry(
                name=name,
                entry_type="person",
                description=(
                    f"{name} is listed as a state legislative member for District {district} "
                    f"with party marker {party} for term {term} in the public roster."
                ),
                city=city or None,
                state=state or None,
                geo_specificity="statewide",
                issue_areas=[
                    "political_polarization_and_democratic_norms",
                    "electoral_reform",
                ],
                website=page.url,
                affiliated_org=_affiliated_org_from_url(page.url),
                extraction_context=context,
                source_url=page.url,
                source_date=source_date,
            )
        )
        index += 6

    return entries


def _extract_plain_text_roster_table_entries(
    page: PageContent,
    *,
    city: str,
    state: str,
) -> list[RawEntry]:
    """Extract roster tables scraped as one plain-text cell per line."""
    lines = [line.strip() for line in page.text.splitlines() if line.strip()]
    data_start = _plain_text_roster_data_start(lines)
    if data_start is None:
        return []

    entries: list[RawEntry] = []
    source_date = page.published_date.date() if page.published_date else None
    row_starts = [
        index
        for index in range(data_start, len(lines))
        if re.fullmatch(r"\d{1,3}[A-Za-z]?", lines[index]) is not None
    ]

    for offset, row_start in enumerate(row_starts):
        row_end = row_starts[offset + 1] if offset + 1 < len(row_starts) else len(lines)
        cells = lines[row_start:row_end]
        if len(cells) < 3:
            continue

        district = cells[0]
        name = _normalize_roster_name(cells[1])
        party = cells[2]
        if not name or party.lower() not in _ROSTER_PARTY_LABELS:
            continue

        context = "\n".join(cells)
        entries.append(
            RawEntry(
                name=name,
                entry_type="person",
                description=(
                    f"{name} is listed as a state legislative member for District {district} "
                    f"with party marker {party} in the public roster."
                ),
                city=city or None,
                state=state or None,
                geo_specificity="statewide",
                issue_areas=[
                    "political_polarization_and_democratic_norms",
                    "electoral_reform",
                ],
                website=page.url,
                affiliated_org=_affiliated_org_from_url(page.url),
                extraction_context=context,
                source_url=page.url,
                source_date=source_date,
            )
        )

    return entries


def _extract_structured_resource_entries(
    page: PageContent,
    *,
    city: str,
    state: str,
) -> list[RawEntry]:
    """Extract people from generic structured CSV/TSV/pipe resources."""
    if not _is_structured_resource_page(page):
        return []

    rows = _structured_resource_rows(page)
    entries: list[RawEntry] = []
    source_date = page.published_date.date() if page.published_date else None
    for row in rows:
        name = _structured_person_name(row)
        if not name or not _looks_like_person_name(name):
            continue

        context_values = _structured_context_values(row)
        if not context_values:
            continue

        entry_city = _first_structured_value(row, ("city", "mailing_city", "candidate_city"))
        entry_state = _first_structured_value(
            row,
            ("office_state", "state", "candidate_state", "mailing_state"),
        )
        source_url = _first_structured_value(row, ("source_url", "url", "profile_url")) or page.url
        entries.append(
            RawEntry(
                name=name,
                entry_type="person",
                description=_structured_person_description(name, row),
                city=entry_city or city or None,
                state=entry_state or state or None,
                geo_specificity="statewide" if entry_state and not entry_city else "local",
                issue_areas=[
                    "political_polarization_and_democratic_norms",
                    "electoral_reform",
                ],
                website=source_url if source_url != page.url else None,
                affiliated_org=_structured_affiliated_org(row, page.url),
                extraction_context=_structured_extraction_context(row),
                source_url=source_url,
                source_date=source_date,
            )
        )

    return entries


def _is_structured_resource_page(page: PageContent) -> bool:
    """Return whether a page came from a structured web resource."""
    return isinstance(page.structured_data.get("resource_format"), str)


def _structured_resource_rows(page: PageContent) -> list[dict[str, str]]:
    """Parse a structured page into normalized row dictionaries."""
    text = page.text.strip()
    if not text:
        return []

    delimiter = _detect_structured_delimiter(text)
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    raw_rows = [
        [cell.strip() for cell in row] for row in reader if any(cell.strip() for cell in row)
    ]
    if not raw_rows:
        return []

    configured_columns = page.structured_data.get("structured_columns")
    if isinstance(configured_columns, list) and all(
        isinstance(column, str) for column in configured_columns
    ):
        headers = [_normalize_structured_header(column) for column in configured_columns]
        data_rows = raw_rows
    else:
        headers = [_normalize_structured_header(column) for column in raw_rows[0]]
        data_rows = raw_rows[1:]

    rows: list[dict[str, str]] = []
    for data_row in data_rows:
        if not data_row:
            continue
        row: dict[str, str] = {}
        for index, header in enumerate(headers):
            if not header or index >= len(data_row):
                continue
            value = data_row[index].strip()
            if value:
                row[header] = value
        if row:
            rows.append(row)
    return rows


def _detect_structured_delimiter(text: str) -> str:
    """Detect the most likely delimiter for structured text."""
    sample_lines = [line for line in text.splitlines()[:10] if line.strip()]
    consistent_counts: dict[str, int] = {}
    for delimiter in (",", "\t", "|"):
        counts = [line.count(delimiter) for line in sample_lines]
        positive_counts = [count for count in counts if count > 0]
        if positive_counts and len(set(positive_counts)) == 1:
            consistent_counts[delimiter] = positive_counts[0]
    if consistent_counts:
        return max(consistent_counts, key=consistent_counts.get)

    sample = "\n".join(sample_lines)
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t|")
        return str(dialect.delimiter)
    except csv.Error:
        counts = {delimiter: sample.count(delimiter) for delimiter in (",", "\t", "|")}
        return max(counts, key=counts.get)


def _normalize_structured_header(value: str) -> str:
    """Normalize a structured column name to a stable key."""
    normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    aliases = {
        "candidate_name": "name",
        "cand_name": "name",
        "person_name": "name",
        "full_name": "name",
        "candidate": "name",
        "candidate_party": "party",
        "party_affiliation": "party",
        "office_district": "district",
        "candidate_office": "office",
        "candidate_office_state": "office_state",
        "candidate_election_year": "election_year",
    }
    return aliases.get(normalized, normalized)


def _structured_person_name(row: dict[str, str]) -> str:
    """Return a normalized person name from a structured row."""
    raw_name = _first_structured_value(row, ("name", "first_last", "display_name"))
    if not raw_name:
        first = _first_structured_value(row, ("first_name", "given_name"))
        last = _first_structured_value(row, ("last_name", "family_name", "surname"))
        raw_name = f"{first} {last}".strip()
    return _normalize_structured_person_name(raw_name)


def _normalize_structured_person_name(raw_name: str) -> str:
    """Normalize a person name from a machine-readable civic row."""
    name = raw_name.strip()
    if not name or "vacancy" in name.lower():
        return ""

    if "," in name:
        last, first = [part.strip() for part in name.split(",", maxsplit=1)]
        given_tokens, suffixes = _structured_name_parts(first)
        family_tokens, family_suffixes = _structured_name_parts(last)
        suffixes.extend(family_suffixes)
        return " ".join([*given_tokens, *family_tokens, *suffixes]).strip()

    body_tokens, suffixes = _structured_name_parts(_strip_civic_title_prefix(name))
    return " ".join([*body_tokens, *suffixes]).strip()


def _structured_name_parts(value: str) -> tuple[list[str], list[str]]:
    """Return display-name tokens and suffix tokens from one structured name side."""
    body_tokens: list[str] = []
    suffixes: list[str] = []
    raw_tokens = [token.strip() for token in re.split(r"\s+", value.strip()) if token.strip()]
    raw_tokens = _without_trailing_structured_credential_spellouts(raw_tokens)
    for raw_token in raw_tokens:
        token = raw_token.strip()
        key = _structured_name_token_key(token)
        if not key:
            continue
        if key in _STRUCTURED_NAME_TITLE_KEYS or key in _STRUCTURED_NAME_CREDENTIAL_KEYS:
            continue
        suffix = _STRUCTURED_NAME_SUFFIX_LABELS.get(key)
        if suffix:
            suffixes.append(suffix)
            continue
        body_tokens.append(_format_structured_name_token(token))
    return body_tokens, suffixes


def _without_trailing_structured_credential_spellouts(tokens: list[str]) -> list[str]:
    """Drop trailing spaced-out credential tokens while preserving initials."""
    trimmed = [token for token in tokens if _structured_name_token_key(token)]
    while trimmed:
        keys = [_structured_name_token_key(token) for token in trimmed]
        credential_end = len(keys)
        while credential_end > 0 and (
            keys[credential_end - 1] in _STRUCTURED_NAME_SUFFIX_LABELS
            or keys[credential_end - 1] in _STRUCTURED_NAME_TITLE_KEYS
        ):
            credential_end -= 1
        removed = False
        for sequence in _STRUCTURED_NAME_CREDENTIAL_SEQUENCES:
            credential_start = credential_end - len(sequence)
            if credential_start >= 0 and tuple(keys[credential_start:credential_end]) == sequence:
                del trimmed[credential_start:credential_end]
                removed = True
                break
        if not removed:
            break
    return trimmed


def _structured_name_token_key(value: str) -> str:
    """Return a comparison key for a structured name token."""
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _format_structured_name_token(value: str) -> str:
    """Format one structured name token for display."""
    token = value.strip(" .,\t\r\n")
    if len(token) == 1:
        return token.upper()
    if token.upper() == token:
        return token.title()
    return token


def _first_structured_value(row: dict[str, str], keys: tuple[str, ...]) -> str:
    """Return the first non-empty value from a structured row."""
    for key in keys:
        value = row.get(key)
        if value:
            return value.strip()
    return ""


def _structured_context_values(row: dict[str, str]) -> list[str]:
    """Return non-name values that make a structured person row meaningful."""
    context_keys = (
        "office",
        "position",
        "role",
        "title",
        "organization",
        "affiliated_org",
        "committee",
        "committee_id",
        "party",
        "election_year",
        "transaction_amount",
        "transaction_date",
        "amount",
        "date",
        "occupation",
        "employer",
        "district",
        "office_state",
        "city",
        "state",
    )
    return [row[key] for key in context_keys if row.get(key)]


def _structured_person_description(name: str, row: dict[str, str]) -> str:
    """Build a concise civic description from structured row fields."""
    office = _first_structured_value(row, ("office", "position", "role", "title"))
    office_state = _first_structured_value(row, ("office_state", "state"))
    district = _first_structured_value(row, ("district",))
    year = _first_structured_value(row, ("election_year", "year"))
    party = _first_structured_value(row, ("party",))
    organization = _first_structured_value(row, ("organization", "affiliated_org"))
    transaction_amount = _first_structured_value(
        row,
        ("transaction_amount", "contribution_amount", "amount"),
    )
    transaction_date = _first_structured_value(
        row, ("transaction_date", "contribution_date", "date")
    )
    occupation = _first_structured_value(row, ("occupation",))
    employer = _first_structured_value(row, ("employer",))

    if office:
        place = office_state
        if district:
            place = f"{place} District {district}".strip()
        description = f"{name} is listed as a {office} candidate"
        if place:
            description += f" for {place}"
        if year:
            description += f" in {year}"
        if party:
            description += f" with party marker {party}"
        return f"{description}."

    if organization:
        return f"{name} is listed with {organization} in the structured public source."

    if transaction_amount or transaction_date or occupation or employer:
        description = f"{name} is listed in a public campaign-finance transaction"
        if transaction_date:
            description += f" dated {transaction_date}"
        if transaction_amount:
            description += f" for {transaction_amount}"
        if occupation:
            description += f" with occupation {occupation}"
        if employer:
            if occupation:
                description += f" and employer {employer}"
            else:
                description += f" with employer {employer}"
        return f"{description}."

    return f"{name} is listed in the structured public source."


def _structured_affiliated_org(row: dict[str, str], source_url: str) -> str:
    """Return the row organization or a readable source host."""
    organization = _first_structured_value(
        row,
        ("organization", "affiliated_org", "committee", "committee_id"),
    )
    if organization:
        return organization
    hostname = urlparse(source_url).netloc.lower().removeprefix("www.")
    known_hosts = {
        "fec.gov": "Federal Election Commission",
        "query.wikidata.org": "Wikidata",
        "data.openstates.org": "OpenStates",
    }
    return known_hosts.get(hostname, hostname or "Structured public source")


def _structured_extraction_context(row: dict[str, str]) -> str:
    """Return a compact source-local row context."""
    parts = [f"{key}={value}" for key, value in row.items() if value]
    return "; ".join(parts[:12])


def _extract_tabular_roster_entries(
    page: PageContent,
    *,
    city: str,
    state: str,
) -> list[RawEntry]:
    """Extract official roster tables rendered as tab-delimited text rows."""
    entries: list[RawEntry] = []
    source_date = page.published_date.date() if page.published_date else None
    lines = [line.strip() for line in page.text.splitlines() if line.strip()]
    header: list[str] | None = None
    header_index: int | None = None
    section = ""

    for index, line in enumerate(lines):
        cells = _split_tabular_roster_row(line)
        lowered_cells = [cell.lower() for cell in cells]
        name_index = _optional_cell_index(lowered_cells, "name")
        if name_index is not None and (
            "district" in lowered_cells or "office" in lowered_cells or "title" in lowered_cells
        ):
            header = lowered_cells
            header_index = name_index
            section = _nearest_roster_section(lines, index)
            continue

        if header is None or header_index is None or len(cells) <= header_index:
            continue

        label = _tabular_roster_label(cells, header)
        name = _normalize_roster_name(_strip_civic_title_prefix(cells[header_index]))
        if not label or not _looks_like_person_name(name):
            continue

        context = "\n".join([section, line] if section else [line])
        entries.append(
            RawEntry(
                name=name,
                entry_type="person",
                description=_tabular_roster_description(name, label, section),
                city=city or None,
                state=state or None,
                geo_specificity="local",
                issue_areas=["local_government_and_civic_engagement"],
                website=page.url,
                affiliated_org=_affiliated_org_from_url(page.url),
                extraction_context=context,
                source_url=page.url,
                source_date=source_date,
            )
        )

    return entries


def _extract_plain_text_office_roster_entries(
    page: PageContent,
    *,
    city: str,
    state: str,
) -> list[RawEntry]:
    """Extract public officials from plain-text office roster blocks."""
    entries: list[RawEntry] = []
    source_date = page.published_date.date() if page.published_date else None
    lines = [line.strip() for line in page.text.splitlines() if line.strip()]

    for index, line in enumerate(lines):
        name = _normalize_roster_name(_strip_civic_title_prefix(line))
        if not name or not _looks_like_person_name(name):
            continue

        next_line = lines[index + 1] if index + 1 < len(lines) else ""
        previous_line = lines[index - 1] if index > 0 else ""

        if _looks_like_office_label(next_line):
            context = "\n".join(lines[index : min(index + 2, len(lines))])
            entries.append(
                RawEntry(
                    name=name,
                    entry_type="person",
                    description=f"{name} is listed as {next_line} in the public office roster.",
                    city=city or None,
                    state=state or None,
                    geo_specificity="local",
                    issue_areas=["local_government_and_civic_engagement"],
                    website=page.url,
                    affiliated_org=_affiliated_org_from_url(page.url),
                    extraction_context=context,
                    source_url=page.url,
                    source_date=source_date,
                )
            )
            continue

        if previous_line.isdigit() and _looks_like_civic_jurisdiction(next_line):
            party = lines[index + 2] if index + 2 < len(lines) else ""
            if party.lower() not in _ROSTER_PARTY_LABELS:
                continue
            context_end = min(index + 4, len(lines))
            context = "\n".join(lines[index - 1 : context_end])
            entries.append(
                RawEntry(
                    name=name,
                    entry_type="person",
                    description=(
                        f"{name} is listed as a public officeholder for District "
                        f"{previous_line} in {next_line} with party marker {party}."
                    ),
                    city=city or None,
                    state=state or None,
                    geo_specificity="local",
                    issue_areas=["local_government_and_civic_engagement"],
                    website=page.url,
                    affiliated_org=_affiliated_org_from_url(page.url),
                    extraction_context=context,
                    source_url=page.url,
                    source_date=source_date,
                )
            )

    return entries


def _plain_text_roster_data_start(lines: list[str]) -> int | None:
    """Return the first data-cell index after a plain-text roster header."""
    name_headers = {"name", "member", "representative", "senator"}
    for index in range(len(lines) - 2):
        if (
            lines[index].lower() == "district"
            and lines[index + 1].lower() in name_headers
            and lines[index + 2].lower() == "party"
        ):
            data_start = index + 3
            while data_start < len(lines):
                if re.fullmatch(r"\d{1,3}[A-Za-z]?", lines[data_start]) is not None:
                    return data_start
                data_start += 1
            return None
    return None


def _split_markdown_table_row(row: str) -> list[str]:
    """Split a markdown table row while keeping only non-empty edge cells."""
    return [cell.strip() for cell in row.strip().strip("|").split("|")]


def _split_tabular_roster_row(row: str) -> list[str]:
    """Split a text-rendered table row into cells."""
    if "\t" in row:
        return [cell.strip() for cell in row.split("\t")]
    return [cell.strip() for cell in re.split(r"\s{2,}", row) if cell.strip()]


def _is_markdown_separator_row(cells: list[str]) -> bool:
    """Return whether a markdown row is the header separator."""
    return all(cell.replace("-", "").replace(":", "").strip() == "" for cell in cells)


def _looks_like_roster_header(cells: list[str]) -> bool:
    """Return whether a table header looks like a public-office roster."""
    return "district" in cells or "office" in cells or "party" in cells


def _looks_like_numbered_roster_row(cells: list[str]) -> bool:
    """Return whether a table row directly encodes district, name, place, party."""
    if len(cells) < 4:
        return False
    if not cells[0].strip().isdigit():
        return False
    if cells[3].strip().lower() not in _ROSTER_PARTY_LABELS:
        return False
    name = _strip_civic_title_prefix(cells[1])
    return _looks_like_person_name(name)


def _roster_name_column_index(cells: list[str]) -> int | None:
    """Return the column index containing a roster member's name."""
    for candidate in ("name", "member", "representative", "senator"):
        if candidate in cells:
            return cells.index(candidate)
    return None


def _optional_cell_index(cells: list[str], name: str) -> int | None:
    """Return the index of an optional table column."""
    return cells.index(name) if name in cells else None


def _cell_at(cells: list[str], index: int | None) -> str:
    """Return a table cell when that optional column exists."""
    if index is None or index >= len(cells):
        return ""
    return cells[index].strip()


def _nearest_roster_section(lines: list[str], header_index: int) -> str:
    """Return the nearest plain section label above a roster table header."""
    for index in range(header_index - 1, max(-1, header_index - 6), -1):
        candidate = lines[index].strip()
        if not candidate or "\t" in candidate:
            continue
        if len(candidate) <= 120:
            return candidate
    return ""


def _tabular_roster_label(cells: list[str], header: list[str]) -> str:
    """Return the office or district label for a text-rendered roster row."""
    office_index = _optional_cell_index(header, "office")
    if office_index is not None:
        return _cell_at(cells, office_index)

    title_index = _optional_cell_index(header, "title")
    if title_index is not None:
        return _cell_at(cells, title_index)

    district_index = _optional_cell_index(header, "district")
    district = _cell_at(cells, district_index)
    if district.lower() == "total":
        return ""
    if district:
        return f"District {district}"
    return ""


def _tabular_roster_description(name: str, label: str, section: str) -> str:
    """Build a concise source-grounded description for a tabular roster row."""
    if section:
        return f"{name} is listed as {label} in the {section} public roster."
    return f"{name} is listed as {label} in the public roster."


def _clean_pipe_cell(raw_value: str) -> str:
    """Remove pipe delimiters left in text-only roster cells."""
    return raw_value.strip().strip("|").strip()


def _looks_like_office_label(value: str) -> bool:
    """Return whether a line names a public office or elected seat."""
    lowered = value.lower().strip()
    if not lowered:
        return False
    if len(lowered) > 80 or "." in lowered:
        return False
    office_markers = (
        "mayor",
        "council",
        "commissioner",
        "supervisor",
        "district",
        "trustee",
        "board member",
        "chair",
        "secretary",
        "member-at-large",
        "member at-large",
        "member at large",
        "business/industry",
        "gaming",
        "physician",
    )
    return any(marker in lowered for marker in office_markers)


def _looks_like_civic_jurisdiction(value: str) -> bool:
    """Return whether a line is a civic jurisdiction in a roster row."""
    lowered = value.lower().strip()
    if not lowered:
        return False
    if lowered in _BOROUGH_LABELS:
        return True
    return "/" in lowered and all(part.strip() in _BOROUGH_LABELS for part in lowered.split("/"))


def _looks_like_person_name(value: str) -> bool:
    """Return whether a roster cell looks like a named person."""
    name = _strip_civic_title_prefix(value).strip()
    if name.lower() in {"top requests", "quick links", "city council", "board of trustees"}:
        return False
    if not name or any(char.isdigit() for char in name):
        return False
    if _looks_like_office_label(name):
        return False
    words = [word for word in re.split(r"\s+", name) if word]
    if len(words) < 2 or len(words) > 5:
        return False
    return all(_looks_like_name_word(word) for word in words)


def _looks_like_name_word(value: str) -> bool:
    """Return whether one token looks like part of a person's name."""
    cleaned = value.replace(".", "").replace("'", "").replace("-", "")
    return bool(cleaned) and cleaned[0].isupper() and all(char.isalpha() for char in cleaned)


def _strip_civic_title_prefix(value: str) -> str:
    """Remove role and honorific prefixes from roster names."""
    name = value.strip()
    role_prefixes = (
        "Speaker",
        "Majority Leader",
        "Majority Whip",
        "Minority Leader",
        "Minority Whip",
        "Deputy Speaker",
        "Chair",
        "Vice Chair",
    )
    for prefix in sorted(role_prefixes, key=len, reverse=True):
        marker = f"{prefix} "
        if name.startswith(marker):
            name = name[len(marker) :]
            break
    honorific_prefixes = ("Dr. ", "Hon. ", "The Honorable ")
    for prefix in honorific_prefixes:
        if name.startswith(prefix):
            name = name[len(prefix) :]
            break
    return name.strip()


def _affiliated_org_from_url(url: str) -> str:
    """Return a readable source organization for known roster hosts."""
    hostname = urlparse(url).netloc.lower().removeprefix("www.")
    known_hosts = {
        "clerk.lacity.gov": "Los Angeles City Clerk",
        "lacity.gov": "City of Los Angeles",
        "clarkcountynv.gov": "Clark County",
        "ccsd.net": "Clark County School District",
        "southernnevadahealthdistrict.org": "Southern Nevada Health District",
    }
    if hostname in known_hosts:
        return known_hosts[hostname]
    if "assembly.ca.gov" in url:
        return "California State Assembly"
    if "senate.ca.gov" in url:
        return "California State Senate"
    if "house.gov" in url:
        return "U.S. House of Representatives"
    if "senate.gov" in url:
        return "United States Senate"
    return "State legislature"


def _normalize_roster_name(raw_name: str) -> str:
    """Normalize roster names while rejecting vacancies and blank cells."""
    name = raw_name.strip()
    if not name or "vacancy" in name.lower():
        return ""
    if "," not in name:
        return name
    last, first = [part.strip() for part in name.split(",", maxsplit=1)]
    if _is_name_suffix(first):
        return last
    return f"{first} {last}".strip()


def _is_name_suffix(value: str) -> bool:
    """Return whether a comma-delimited name part is a credential or suffix."""
    normalized = value.lower().replace(".", "").replace(",", "").strip()
    return normalized in {"md", "do", "phd", "jr", "sr"}


async def _pass_identify(
    page: PageContent,
    provider: LLMProvider,
    *,
    on_retry: Callable[[dict[str, object]], None] | None = None,
) -> list[dict[str, str]]:
    """Pass 1: Identify all named civic entities in the text.

    Returns a list of dicts with 'name', 'type', and 'quote' fields.
    This is a deliberately simple task that any model can handle.
    """
    structured_block = ""
    if page.structured_data:
        structured_block = (
            "\n--- Page metadata ---\n"
            f"{json.dumps(page.structured_data, indent=2, default=str)}\n"
            "--- End metadata ---\n\n"
        )

    messages = [
        Message(
            role="system",
            content=(
                "You identify people, organizations, and initiatives mentioned in text. "
                "Return ONLY a JSON array. Each item must have:\n"
                '- "name": the exact name as it appears in the text\n'
                '- "type": one of person, organization, initiative, campaign, event\n'
                '- "quote": a verbatim sentence or table row from the text where this entity is mentioned\n\n'
                "Rules:\n"
                "- Only include names that appear VERBATIM in the text\n"
                "- Do NOT invent or infer names\n"
                "- Include everyone: leaders, staff, quoted sources, roster rows, partner orgs, funders\n"
                "- If no entities are found, return []\n\n"
                "Example output:\n"
                '[{"name": "Jane Doe", "type": "person", "quote": "Jane Doe, director of Housing First, said..."}, '
                '{"name": "Housing First", "type": "organization", "quote": "Housing First has served 500 families since 2020."}]'
            ),
        ),
        Message(
            role="user",
            content=f"{structured_block}{page.text}",
        ),
    ]

    for attempt in range(1, _MAX_EXTRACTION_ATTEMPTS + 1):
        try:
            completion = await provider.complete(messages)
            return _parse_identify_response(completion.text)
        except Exception as exc:
            if attempt >= _MAX_EXTRACTION_ATTEMPTS:
                raise ExtractionFailedError(
                    f"{_error_reason(exc)} after {_MAX_EXTRACTION_ATTEMPTS} attempts"
                ) from exc
            if on_retry is not None:
                on_retry({"url": page.url, "attempt": attempt + 1, "reason": _error_reason(exc)})
            await asyncio.sleep(_RETRY_BACKOFF_SECONDS * attempt)

    # The for-loop above always either returns or raises on the final attempt,
    # so this line is unreachable; assert documents the invariant.
    raise AssertionError("unreachable: identify pass loop must return or raise")  # pragma: no cover


async def _pass_enrich(
    identified: list[dict[str, str]],
    page: PageContent,
    provider: LLMProvider,
    *,
    system_prompt: str,
    on_retry: Callable[[dict[str, object]], None] | None = None,
) -> list[RawEntry]:
    """Pass 2: Enrich identified entities with structured details.

    Takes the simple name+type+quote list from Pass 1 and asks the model
    to fill in the full schema for all entities at once, using the source
    text as context.
    """
    entity_summary = "\n".join(
        f'- {e["name"]} ({e.get("type", "unknown")}): "{e.get("quote", "")}"' for e in identified
    )

    messages = [
        Message(role="system", content=system_prompt),
        Message(
            role="user",
            content=(
                f"Source URL: {page.url}\n\n"
                "These entities were identified in the text below. "
                "For each one, extract the full structured entry.\n\n"
                f"IDENTIFIED ENTITIES:\n{entity_summary}\n\n"
                f"SOURCE TEXT:\n{page.text}"
            ),
        ),
    ]

    for attempt in range(1, _MAX_EXTRACTION_ATTEMPTS + 1):
        try:
            completion = await provider.complete(messages, _StructuredExtractionResponse)
            return _parse_extraction_response(completion)
        except Exception as exc:
            reason = _error_reason(exc)
            if attempt >= _MAX_EXTRACTION_ATTEMPTS:
                raise ExtractionFailedError(
                    f"{reason} after {_MAX_EXTRACTION_ATTEMPTS} attempts"
                ) from exc
            if on_retry is not None:
                on_retry({"url": page.url, "attempt": attempt + 1, "reason": reason})
            await asyncio.sleep(_RETRY_BACKOFF_SECONDS * attempt)

    # The for-loop above always either returns or raises on the final attempt,
    # so this line is unreachable; assert documents the invariant.
    raise AssertionError("unreachable: enrich pass loop must return or raise")  # pragma: no cover


def _parse_identify_response(text: str) -> list[dict[str, str]]:
    """Parse Pass 1 response: a JSON array of {name, type, quote} dicts."""
    text = _strip_code_fence(text)

    # Handle reasoning models that emit <think>...</think> before JSON
    if "</think>" in text:
        text = text.split("</think>")[-1].strip()

    try:
        items = json.loads(text)
    except json.JSONDecodeError:
        # Try to find a JSON array in the response
        start = text.find("[")
        end = text.rfind("]")
        if start >= 0 and end > start:
            try:
                items = json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                return []
        else:
            return []

    if not isinstance(items, list):
        return []

    results: list[dict[str, str]] = []
    for item in items:
        if isinstance(item, dict) and "name" in item:
            results.append(
                {
                    "name": str(item.get("name", "")),
                    "type": str(item.get("type", "organization")),
                    "quote": str(item.get("quote", "")),
                }
            )
    return results


def _build_system_prompt(
    city: str,
    state: str,
    *,
    extraction_directive: str | None = None,
) -> str:
    """Build the extraction system prompt with full taxonomy context."""
    taxonomy_lines = [
        f"- {issue.slug}: {issue.name}"
        for issues in ISSUE_AREAS_BY_DOMAIN.values()
        for issue in issues
    ]
    taxonomy_text = "\n".join(taxonomy_lines)
    location_instruction = (
        f"Target location: {city}, {state}\n\n"
        "Only include people, organizations, initiatives, campaigns, or events "
        "connected to the target location and one or more issue areas."
        if city or state
        else "No target location was provided. Infer the primary geography from the "
        "source text and only include entities meaningfully connected to that "
        "place and one or more issue areas."
    )
    prompt = (
        "You are a civic research assistant extracting structured data from a source "
        "document for Atlas, a national directory of people and organizations doing "
        "civic work in America.\n\n"
        f"{location_instruction}\n\n"
        "Issue taxonomy:\n"
        f"{taxonomy_text}\n\n"
        "RULES — read carefully:\n"
        "1. ONLY extract entities whose names appear VERBATIM in the source text. "
        "Do NOT invent, infer, or hallucinate entity names. If a name is not "
        "written in the text, do not create an entry for it.\n"
        "2. The extraction_context field MUST be a VERBATIM quote copied directly "
        "from the source text that proves this entity exists. This can be a "
        "sentence, table row, or source-text fragment. This is mandatory. "
        "If you cannot provide a direct quote, do not include the entry.\n"
        "3. Extract EVERY person, organization, initiative, campaign, or event "
        "that IS named in the text — not just the primary subject. Include:\n"
        "   - People quoted, interviewed, or named as leaders/staff/board members\n"
        "   - Organizations named as partners, funders, allies, or coalition members\n"
        "   - Campaigns, initiatives, or events referenced by name\n"
        "4. For person entries, the name MUST be the person's actual proper name, "
        "not only a title, role, office, district, ward, or seat label. Do not "
        "create person entries named like 'Councilman Ward 1', 'Board Member', "
        "'District 3 representative', or 'Chair'. If the source names only a role "
        "without a person's proper name, do not create a person entry for it.\n"
        "5. For each entry, populate mentioned_entities: other entities referenced "
        "in connection to this entry. Each mention needs: "
        '"name" (verbatim from text), "type" (person/organization/initiative), '
        'and "relationship" (founder, board_member, partner, funder, member, '
        "coalition_member, staff, quoted_source, ally).\n"
        "6. At the top level, include discovery_leads: URLs and entity names from "
        "the text worth following up. Only include leads that appear in the text.\n\n"
        'Return JSON with keys: "entries" (array) and "discovery_leads" (array of strings). '
        "Each entry must contain: name, type, description, city, state, "
        "geo_specificity, issue_areas, affiliated_org, website, email, "
        "social_media, extraction_context, mentioned_entities.\n"
        'If no entities are named in the text, return {"entries": [], "discovery_leads": []}.'
    )
    if extraction_directive:
        prompt += f"\n\nOperator directive:\n{extraction_directive.strip()}"
    return prompt


def _parse_extraction_response(completion: Completion) -> list[RawEntry]:
    """Parse and validate a structured extraction response into RawEntry objects."""
    payload = completion.parsed
    if payload is None:
        try:
            payload = json.loads(_strip_code_fence(completion.text))
        except json.JSONDecodeError as exc:
            raise ExtractionFailedError(f"invalid_json_response: {exc}") from exc

    if isinstance(payload, list):
        payload = {"entries": payload}

    try:
        structured = _StructuredExtractionResponse.model_validate(payload)
    except Exception as exc:
        raise ExtractionFailedError(f"structured_output_validation_failed: {exc}") from exc

    entries: list[RawEntry] = []
    page_leads = structured.discovery_leads
    for idx, item in enumerate(structured.entries):
        entries.append(
            RawEntry(
                name=item.name,
                entry_type=_normalize_entity_type(item.type),
                description=item.description,
                city=item.city,
                state=item.state,
                geo_specificity=_normalize_geo_specificity(item.geo_specificity),
                issue_areas=item.issue_areas,
                region=item.region,
                website=item.website,
                email=item.email,
                social_media=item.social_media,
                affiliated_org=item.affiliated_org,
                extraction_context=item.extraction_context,
                mentioned_entities=item.mentioned_entities,
                discovery_leads=page_leads if idx == 0 else [],
            )
        )

    return entries


_GEO_ALIASES: dict[str, str] = {
    "local": "local",
    "city": "local",
    "city-level": "local",
    "neighborhood": "local",
    "targeted": "local",
    "regional": "regional",
    "county": "regional",
    "metro": "regional",
    "district": "regional",
    "statewide": "statewide",
    "state": "statewide",
    "state-level": "statewide",
    "national": "national",
    "federal": "national",
    "nationwide": "national",
}

_TYPE_ALIASES: dict[str, str] = {
    "person": "person",
    "individual": "person",
    "people": "person",
    "organization": "organization",
    "org": "organization",
    "nonprofit": "organization",
    "ngo": "organization",
    "initiative": "initiative",
    "program": "initiative",
    "project": "initiative",
    "campaign": "campaign",
    "movement": "campaign",
    "event": "event",
    "conference": "event",
    "rally": "event",
}


def _normalize_geo_specificity(value: str) -> str:
    """Normalize LLM geo_specificity output to a valid enum value."""
    normalized = value.lower().strip()
    result = _GEO_ALIASES.get(normalized)
    if result is None:
        logger.warning("Unknown geo_specificity %r from LLM — defaulting to 'local'", value)
        return "local"
    return result


def _normalize_entity_type(value: str) -> str:
    """Normalize LLM entity type output to a valid enum value."""
    normalized = value.lower().strip()
    result = _TYPE_ALIASES.get(normalized)
    if result is None:
        logger.warning("Unknown entity type %r from LLM — defaulting to 'organization'", value)
        return "organization"
    return result


from atlas_scout.pipeline_support import error_reason as _error_reason  # noqa: E402


def _validate_against_source(entries: list[RawEntry], page: PageContent) -> list[RawEntry]:
    """Drop entries that are not grounded in the source text."""
    return validate_entries(entries, page)


from atlas_scout.pipeline_support import strip_code_fence as _strip_code_fence  # noqa: E402


def _prompt_key(system_prompt: str) -> str:
    """Build a stable prompt fingerprint for extraction caching."""
    return hashlib.sha256(system_prompt.encode("utf-8")).hexdigest()


def _page_fingerprint(page: PageContent) -> str:
    """Build a stable page-content fingerprint independent of URL."""
    published = page.published_date.isoformat() if page.published_date else ""
    structured = (
        json.dumps(page.structured_data, sort_keys=True, default=str)
        if page.structured_data
        else ""
    )
    payload = "\n".join(
        [
            page.title or "",
            page.publication or "",
            published,
            str(page.source_type),
            page.text,
            structured,
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _provider_cache_key(provider: LLMProvider) -> str:
    """Return a stable cache identity for an extraction provider."""
    explicit = getattr(provider, "cache_identity", None)
    if isinstance(explicit, str) and explicit:
        return explicit
    model = getattr(provider, "model", None) or getattr(provider, "_model", None)
    if isinstance(model, str) and model:
        return f"{provider.__class__.__name__.lower()}:{model}"
    return provider.__class__.__name__.lower()


def _extraction_cache_key(
    *,
    source_fingerprint: str,
    provider_key: str,
    prompt_key: str,
) -> str:
    """Combine content, provider, and prompt fingerprints into a cache key."""
    payload = "\n".join([source_fingerprint, provider_key, prompt_key])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _cacheable_entry(entry: RawEntry) -> dict[str, Any]:
    """Prepare a raw entry for durable caching without binding it to one source URL."""
    payload = entry.model_dump(mode="json")
    payload["source_url"] = ""
    return payload


def _entries_from_cached(items: list[dict[str, Any]], *, source_url: str) -> list[RawEntry]:
    """Rehydrate cached entries and stamp the current source URL onto each one."""
    entries = [RawEntry.model_validate(item) for item in items]
    for entry in entries:
        entry.source_url = source_url
    return entries
