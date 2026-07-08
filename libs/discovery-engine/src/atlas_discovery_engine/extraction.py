"""Shared extraction primitives: prompts, schemas, parsing, normalization, and validation.

Consumers (API and Scout) provide their own LLM client. This module provides
the prompt templates, structured output schemas, response parsing, entity-type
and geo-specificity normalization, and grounding validation that both use
identically.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any

from atlas_shared import ISSUE_AREAS_BY_DOMAIN, RawEntry
from pydantic import BaseModel, BeforeValidator, Field

from atlas_discovery_engine.extraction_support import (
    normalize_entity_type,
    normalize_geo_specificity,
    validate_entries,
)

logger = logging.getLogger(__name__)

__all__ = [
    "ExtractionFailedError",
    "StructuredExtractionItem",
    "StructuredExtractionResponse",
    "build_extraction_system_prompt",
    "build_identify_system_prompt",
    "normalize_entity_type",
    "normalize_geo_specificity",
    "parse_extraction_response",
    "parse_identify_response",
    "strip_code_fence",
    "validate_entries",
]


class ExtractionFailedError(RuntimeError):
    """Raised when a page could not be extracted due to provider/output failure."""


# ---------------------------------------------------------------------------
# Coercers for tolerant Pydantic models (LLMs send null for optional fields)
# ---------------------------------------------------------------------------


def _coerce_dict(v: dict[str, str] | None) -> dict[str, str]:
    return v if v is not None else {}


def _coerce_str_list(v: list[str] | None) -> list[str]:
    return v if v is not None else []


def _coerce_mention_list(v: list[dict[str, str]] | None) -> list[dict[str, str]]:
    return v if v is not None else []


# ---------------------------------------------------------------------------
# Structured output schemas
# ---------------------------------------------------------------------------


class StructuredExtractionItem(BaseModel):
    """Schema for one extracted Atlas entry — tolerant of null fields from LLMs."""

    name: str
    type: str
    description: str = ""
    city: str | None = None
    state: str | None = None
    geo_specificity: str = "local"
    issue_areas: Annotated[list[str], BeforeValidator(_coerce_str_list)] = Field(
        default_factory=list,
    )
    region: str | None = None
    website: str | None = None
    email: str | None = None
    social_media: Annotated[dict[str, str], BeforeValidator(_coerce_dict)] = Field(
        default_factory=dict,
    )
    affiliated_org: str | None = None
    extraction_context: str = ""
    mentioned_entities: Annotated[list[dict[str, str]], BeforeValidator(_coerce_mention_list)] = (
        Field(default_factory=list)
    )


class StructuredExtractionResponse(BaseModel):
    """Strict structured-output envelope for extraction responses."""

    entries: list[StructuredExtractionItem] = Field(default_factory=list)
    discovery_leads: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------


def build_identify_system_prompt() -> str:
    """Build the Pass 1 system prompt: identify named entities in text."""
    return (
        "You identify people, organizations, and initiatives mentioned in text. "
        "Return ONLY a JSON array. Each item must have:\n"
        '- "name": the exact name as it appears in the text\n'
        '- "type": one of person, organization, initiative, campaign, event\n'
        '- "quote": a verbatim sentence from the text where this entity is mentioned\n\n'
        "Rules:\n"
        "- Only include names that appear VERBATIM in the text\n"
        "- Do NOT invent or infer names\n"
        "- Include everyone: leaders, staff, quoted sources, partner orgs, funders\n"
        "- If no entities are found, return []\n\n"
        "Example output:\n"
        '[{"name": "Jane Doe", "type": "person", "quote": "Jane Doe, director of Housing First, said..."}, '
        '{"name": "Housing First", "type": "organization", "quote": "Housing First has served 500 families since 2020."}]'
    )


def build_extraction_system_prompt(
    city: str,
    state: str,
    *,
    extraction_directive: str | None = None,
) -> str:
    """Build the Pass 2 extraction system prompt with full taxonomy context."""
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
        "from the source text that proves this entity exists. This is mandatory. "
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


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------


def parse_identify_response(text: str) -> list[dict[str, str]]:
    """Parse Pass 1 response: a JSON array of {name, type, quote} dicts."""
    text = strip_code_fence(text)

    if "</think>" in text:
        text = text.split("</think>")[-1].strip()

    try:
        items = json.loads(text)
    except json.JSONDecodeError:
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


def parse_extraction_response(
    text: str | None = None,
    parsed: Any = None,
) -> list[RawEntry]:
    """Parse and validate a structured extraction response into RawEntry objects.

    Parameters
    ----------
    text : str | None
        Raw response text from the LLM (used when *parsed* is None).
    parsed : Any
        Pre-parsed response dict/object (e.g. from structured output).
    """
    payload = parsed
    if payload is None:
        if text is None:
            return []
        try:
            payload = json.loads(strip_code_fence(text))
        except json.JSONDecodeError as exc:
            raise ExtractionFailedError(f"invalid_json_response: {exc}") from exc

    if isinstance(payload, list):
        payload = {"entries": payload}

    try:
        structured = StructuredExtractionResponse.model_validate(payload)
    except Exception as exc:
        raise ExtractionFailedError(f"structured_output_validation_failed: {exc}") from exc

    entries: list[RawEntry] = []
    page_leads = structured.discovery_leads
    for idx, item in enumerate(structured.entries):
        entries.append(
            RawEntry(
                name=item.name,
                entry_type=normalize_entity_type(item.type),
                description=item.description,
                city=item.city,
                state=item.state,
                geo_specificity=normalize_geo_specificity(item.geo_specificity),
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


def strip_code_fence(value: str) -> str:
    """Remove optional Markdown fences around a JSON response."""
    stripped = value.strip()
    if stripped.startswith("```"):
        stripped = stripped.split("\n", 1)[1]
        stripped = stripped.rsplit("\n```", 1)[0]
    return stripped
