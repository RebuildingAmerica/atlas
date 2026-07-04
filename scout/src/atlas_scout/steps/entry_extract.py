"""Step 3: Entry Extraction with streaming concurrency and durable caching."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from typing import TYPE_CHECKING, Annotated, Any

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
_SENATE_CONTACT_HEADER_RE = re.compile(
    r"^(?P<label>.+) \((?P<party>[A-Z])-(?P<state>[A-Z]{2})\)$"
)


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
    issue_areas: Annotated[list[str], BeforeValidator(_coerce_str_list)] = Field(default_factory=list)
    region: str | None = None
    website: str | None = None
    email: str | None = None
    social_media: Annotated[dict[str, str], BeforeValidator(_coerce_dict)] = Field(default_factory=dict)
    affiliated_org: str | None = None
    extraction_context: str = ""
    mentioned_entities: Annotated[list[dict[str, str]], BeforeValidator(_coerce_mention_list)] = Field(default_factory=list)


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
    roster_entries = _extract_roster_table_entries(page, city=city, state=state)
    if roster_entries:
        return roster_entries
    senate_entries = _extract_senate_contact_entries(page, city=city, state=state)
    if senate_entries:
        return senate_entries

    # --- Pass 1: Identify all named entities ---
    identified = await _pass_identify(page, provider, on_retry=on_retry)
    if not identified:
        return []

    # --- Pass 2: Enrich each entity with structured details ---
    entries = await _pass_enrich(
        identified, page, provider, system_prompt=system_prompt, on_retry=on_retry,
    )
    entries = _validate_against_source(entries, page)
    page_date = page.published_date.date() if page.published_date else None
    for entry in entries:
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
        if "name" in normalized_cells and _looks_like_roster_header(normalized_cells):
            name_index = normalized_cells.index("name")
            district_index = _optional_cell_index(normalized_cells, "district")
            party_index = _optional_cell_index(normalized_cells, "party")
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
                affiliated_org="U.S. House of Representatives",
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


def _split_markdown_table_row(row: str) -> list[str]:
    """Split a markdown table row while keeping only non-empty edge cells."""
    return [cell.strip() for cell in row.strip().strip("|").split("|")]


def _is_markdown_separator_row(cells: list[str]) -> bool:
    """Return whether a markdown row is the header separator."""
    return all(cell.replace("-", "").replace(":", "").strip() == "" for cell in cells)


def _looks_like_roster_header(cells: list[str]) -> bool:
    """Return whether a table header looks like a public-office roster."""
    return "district" in cells or "office" in cells or "party" in cells


def _optional_cell_index(cells: list[str], name: str) -> int | None:
    """Return the index of an optional table column."""
    return cells.index(name) if name in cells else None


def _cell_at(cells: list[str], index: int | None) -> str:
    """Return a table cell when that optional column exists."""
    if index is None or index >= len(cells):
        return ""
    return cells[index].strip()


def _normalize_roster_name(raw_name: str) -> str:
    """Normalize roster names while rejecting vacancies and blank cells."""
    name = raw_name.strip()
    if not name or "vacancy" in name.lower():
        return ""
    if "," not in name:
        return name
    last, first = [part.strip() for part in name.split(",", maxsplit=1)]
    return f"{first} {last}".strip()


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
        f"- {e['name']} ({e.get('type', 'unknown')}): \"{e.get('quote', '')}\""
        for e in identified
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
            results.append({
                "name": str(item.get("name", "")),
                "type": str(item.get("type", "organization")),
                "quote": str(item.get("quote", "")),
            })
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
        "4. For each entry, populate mentioned_entities: other entities referenced "
        "in connection to this entry. Each mention needs: "
        '"name" (verbatim from text), "type" (person/organization/initiative), '
        'and "relationship" (founder, board_member, partner, funder, member, '
        "coalition_member, staff, quoted_source, ally).\n"
        "5. At the top level, include discovery_leads: URLs and entity names from "
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
    structured = json.dumps(page.structured_data, sort_keys=True, default=str) if page.structured_data else ""
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
