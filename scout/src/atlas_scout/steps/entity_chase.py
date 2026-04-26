"""
Step 8: Entity Chasing & LLM-Driven Follow-Up.

Uses the LLM to reason about discovered entities and gaps, then generates
targeted follow-up searches and fetches to deepen discovery.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from atlas_shared import GapReport, RankedEntry, RawEntry

from atlas_scout.pipeline_support import strip_code_fence as _strip_code_fence
from atlas_scout.providers.base import Completion, Message
from atlas_scout.steps.query_gen import SearchQuery

if TYPE_CHECKING:
    from atlas_scout.providers.base import LLMProvider

logger = logging.getLogger(__name__)

__all__ = ["generate_followup_queries", "select_entities_to_chase"]


async def generate_followup_queries(
    provider: LLMProvider,
    *,
    location: str,
    issues: list[str],
    gap_report: GapReport,
    existing_entries: list[RankedEntry],
    max_queries: int = 30,
) -> list[SearchQuery]:
    """Ask the LLM to generate targeted follow-up search queries.

    The LLM sees the gap report (thin/missing issues) and existing entries,
    then crafts search queries a human researcher would use to fill the gaps.
    """
    entry_summary = "\n".join(
        f"- {r.entry.name} ({r.entry.entry_type}) — {', '.join(r.entry.issue_areas[:3])}"
        for r in existing_entries[:30]
    )

    prompt = (
        f"You are a civic research assistant. You just ran a discovery pipeline for "
        f"{location} and found {len(existing_entries)} entities.\n\n"
        f"GAP REPORT:\n"
        f"- Covered issues (3+ entries): {', '.join(gap_report.covered_issues) or 'none'}\n"
        f"- Thin issues (1-2 entries): {', '.join(gap_report.thin_issues) or 'none'}\n"
        f"- Missing issues (0 entries): {', '.join(gap_report.missing_issues) or 'none'}\n"
        f"- Uncovered domains: {', '.join(gap_report.uncovered_domains) or 'none'}\n\n"
        f"EXISTING ENTRIES (top 30):\n{entry_summary}\n\n"
        f"Generate up to {max_queries} targeted web search queries to fill the gaps. "
        f"Focus on:\n"
        f"1. Missing and thin issue areas — find people/orgs doing that work in {location}\n"
        f"2. Organizations mentioned in existing entries that we haven't researched yet\n"
        f"3. Specific search strategies: staff pages, board members, coalition partners\n"
        f"4. Government agencies and programs related to missing issues\n"
        f"5. Social media and directory searches for underrepresented areas\n\n"
        f"Return a JSON array of objects with 'query' (the search string) and "
        f"'issue_area' (the issue slug this targets). Only use issue slugs from: "
        f"{', '.join(issues)}\n\n"
        f"Return ONLY the JSON array, no other text."
    )

    messages = [
        Message(role="system", content="You generate web search queries for civic research."),
        Message(role="user", content=prompt),
    ]

    try:
        completion: Completion = await provider.complete(messages)
        return _parse_query_response(completion.text)
    except Exception:
        logger.warning("LLM follow-up query generation failed", exc_info=True)
        return []


async def select_entities_to_chase(
    provider: LLMProvider,
    *,
    entries: list[RankedEntry],
    max_targets: int = 10,
) -> list[dict[str, str]]:
    """Ask the LLM which discovered entities are worth chasing for deeper research.

    Returns a list of dicts with 'name', 'type', 'website' (if known), and
    'search_query' (a targeted search to find more about this entity).
    """
    entry_lines = []
    for r in entries[:50]:
        e = r.entry
        website = e.website or ""
        entry_lines.append(
            f"- {e.name} ({e.entry_type}) city={e.city} website={website} "
            f"issues={','.join(e.issue_areas[:3])} sources={len(e.source_urls)}"
        )
    entry_summary = "\n".join(entry_lines)

    prompt = (
        f"You are triaging discovered civic entities for deeper research.\n\n"
        f"ENTITIES:\n{entry_summary}\n\n"
        f"Select up to {max_targets} entities worth researching further. Prioritize:\n"
        f"1. Organizations with websites we can crawl for staff/board/partner pages\n"
        f"2. Entities with few sources (need more validation)\n"
        f"3. Coalition/network entities that likely have many member organizations\n"
        f"4. People who likely lead organizations we haven't discovered yet\n\n"
        f"Return a JSON array of objects with:\n"
        f"- 'name': entity name\n"
        f"- 'website': URL to research (if known, else empty string)\n"
        f"- 'search_query': a targeted search query to find more about them\n\n"
        f"Return ONLY the JSON array."
    )

    messages = [
        Message(role="system", content="You triage civic entities for research."),
        Message(role="user", content=prompt),
    ]

    try:
        completion: Completion = await provider.complete(messages)
        return _parse_chase_response(completion.text)
    except Exception:
        logger.warning("LLM entity chase selection failed", exc_info=True)
        return []


def _parse_query_response(text: str) -> list[SearchQuery]:
    """Parse LLM-generated follow-up queries."""
    text = _strip_code_fence(text)

    try:
        items = json.loads(text)
    except json.JSONDecodeError:
        return []

    if not isinstance(items, list):
        return []

    queries = []
    for item in items:
        if isinstance(item, dict) and "query" in item:
            queries.append(
                SearchQuery(
                    query=str(item["query"]),
                    source_category="llm_followup",
                    issue_area=str(item.get("issue_area", "")),
                )
            )
    return queries


def _parse_chase_response(text: str) -> list[dict[str, str]]:
    """Parse LLM-generated entity chase targets."""
    text = _strip_code_fence(text)

    try:
        items = json.loads(text)
    except json.JSONDecodeError:
        return []

    if not isinstance(items, list):
        return []

    targets = []
    for item in items:
        if isinstance(item, dict) and "name" in item:
            targets.append({
                "name": str(item.get("name", "")),
                "website": str(item.get("website", "")),
                "search_query": str(item.get("search_query", "")),
            })
    return targets
