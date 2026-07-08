"""Static Atlas MCP prompt templates."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from atlas.platform.mcp.prompts_support import (
    _evidence_threshold_context,
    _optional_context,
    _tool_sequence,
)

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP


def _register_prompt_templates(mcp: FastMCP[Any]) -> None:
    """Register Atlas's static prompt templates."""

    @mcp.prompt(
        name="research_place",
        title="Research A Place",
        description="Build a source-linked civic landscape for a place.",
    )
    def research_place(place: str, issue_focus: str | None = None) -> str:
        """Build a source-linked civic landscape for a place."""
        return f"""Research the civic landscape for {place}.
{_optional_context("Issue focus", issue_focus)}

Use Atlas tools in this order when relevant: {_tool_sequence("resolve_issue_areas", "get_place_profile", "get_place_issue_signals", "search_entities", "get_place_coverage", "get_entity_sources")}.

Prioritize what a reader can verify. Summarize the main people, organizations, initiatives, and campaigns; explain why they matter; and include the public sources, dates, source types, and trust signals that support the answer. If coverage is thin, say which areas are thin without treating absence from Atlas as proof that no civic work exists."""

    @mcp.prompt(
        name="find_civic_actors",
        title="Find Civic Actors",
        description="Find source-linked civic actors for a topic, place, or concern.",
    )
    def find_civic_actors(
        query: str,
        place: str | None = None,
        issue_focus: str | None = None,
        evidence_threshold: str | None = None,
    ) -> str:
        """Find source-linked civic actors for a topic, place, or concern."""
        return f"""Find civic actors related to: {query}.
{_optional_context("Place", place)}{_optional_context("Issue focus", issue_focus)}{_evidence_threshold_context(evidence_threshold)}

Use Atlas tools in this order when relevant: {_tool_sequence("resolve_issue_areas", "search_entities", "get_entity", "get_entity_sources", "get_related_entities")}.

Return a short ranked list of people, organizations, initiatives, campaigns, or events. For each result, show the actor type, the match reason, the most important source-backed facts, and any trust limits. Do not fill gaps with outside assumptions."""

    @mcp.prompt(
        name="inspect_source_trail",
        title="Inspect Source Trail",
        description="Verify what Atlas knows about one civic actor and where it came from.",
    )
    def inspect_source_trail(entity: str, place: str | None = None) -> str:
        """Verify what Atlas knows about one civic actor and where it came from."""
        return f"""Inspect the source trail for this civic actor: {entity}.
{_optional_context("Place hint", place)}

Use Atlas tools in this order when relevant: {_tool_sequence("search_entities", "get_entity", "get_entity_sources", "get_related_entities")}.

Separate verified facts from uncertain or missing details. Show the sources that back the actor's name, type, place, issues, contact details, and relationships. Call out stale, weak, conflicting, or single-source claims plainly."""

    @mcp.prompt(
        name="assess_coverage_gaps",
        title="Assess Coverage Gaps",
        description="Explain strong and weak Atlas coverage for a place or issue focus.",
    )
    def assess_coverage_gaps(place: str, issue_focus: str | None = None) -> str:
        """Explain strong and weak Atlas coverage for a place or issue focus."""
        return f"""Assess Atlas coverage for {place}.
{_optional_context("Issue focus", issue_focus)}

Use Atlas tools in this order when relevant: {_tool_sequence("resolve_issue_areas", "get_place_coverage", "get_place_issue_signals", "search_entities", "search_sources")}.

Explain where Atlas has strong source-backed coverage and where coverage is limited. Treat gaps as Atlas coverage gaps, not as evidence that no civic activity exists. Include counts, example actors or sources, and practical next research questions."""

    @mcp.prompt(
        name="create_research_brief",
        title="Create Research Brief",
        description="Create a source-linked brief from an existing Atlas discovery run.",
    )
    def create_research_brief(run_id: str) -> str:
        """Create a source-linked brief from an existing Atlas discovery run."""
        return f"""Create a research brief from Atlas discovery run {run_id}.

Use Atlas tools in this order when relevant: {_tool_sequence("get_discovery_run", "get_entity_sources", "get_related_entities")}.

Focus on the research question, place, issue areas, discovered actors, strongest sources, unresolved gaps, and what a reader can safely do next. Keep the provenance attached to the conclusions and avoid turning tentative extracted leads into confirmed facts."""
