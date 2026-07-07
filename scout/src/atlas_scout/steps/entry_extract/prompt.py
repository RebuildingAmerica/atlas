"""Prompting and response parsing helpers for entry extraction."""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from typing import TYPE_CHECKING

from atlas_shared import ISSUE_AREAS_BY_DOMAIN, PageContent, RawEntry

from atlas_scout.pipeline_support import error_reason as _error_reason
from atlas_scout.pipeline_support import strip_code_fence as _strip_code_fence
from atlas_scout.providers.base import Completion, LLMProvider, Message
from atlas_scout.steps.entry_extract.models import (
    ExtractionFailedError,
    _StructuredExtractionResponse,
)

if TYPE_CHECKING:
    from collections.abc import Callable

logger = logging.getLogger(__name__)

__all__ = [
    "_build_system_prompt",
    "_normalize_entity_type",
    "_normalize_geo_specificity",
    "_parse_extraction_response",
    "_parse_identify_response",
    "_pass_enrich",
    "_pass_identify",
    "_strip_code_fence",
]


def _config_value(name: str, default: float) -> float:
    """Return a live configuration override from the public entry_extract module."""
    module = sys.modules.get("atlas_scout.steps.entry_extract")
    if module is None:
        return default
    value = getattr(module, name, default)
    return float(value)


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

    max_attempts = int(_config_value("_MAX_EXTRACTION_ATTEMPTS", 5))
    backoff_seconds = _config_value("_RETRY_BACKOFF_SECONDS", 1.0)

    for attempt in range(1, max_attempts + 1):
        try:
            completion = await provider.complete(messages)
            return _parse_identify_response(completion.text)
        except Exception as exc:
            if attempt >= max_attempts:
                raise ExtractionFailedError(
                    f"{_error_reason(exc)} after {max_attempts} attempts"
                ) from exc
            if on_retry is not None:
                on_retry({"url": page.url, "attempt": attempt + 1, "reason": _error_reason(exc)})
            await asyncio.sleep(backoff_seconds * attempt)

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

    max_attempts = int(_config_value("_MAX_EXTRACTION_ATTEMPTS", 5))
    backoff_seconds = _config_value("_RETRY_BACKOFF_SECONDS", 1.0)

    for attempt in range(1, max_attempts + 1):
        try:
            completion = await provider.complete(messages, _StructuredExtractionResponse)
            return _parse_extraction_response(completion)
        except Exception as exc:
            reason = _error_reason(exc)
            if attempt >= max_attempts:
                raise ExtractionFailedError(f"{reason} after {max_attempts} attempts") from exc
            if on_retry is not None:
                on_retry({"url": page.url, "attempt": attempt + 1, "reason": reason})
            await asyncio.sleep(backoff_seconds * attempt)

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
