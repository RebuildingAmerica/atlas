"""Tests for atlas_scout.steps.entity_chase."""

from __future__ import annotations

import json
from datetime import date

import pytest
from atlas_shared import DeduplicatedEntry, GapReport, RankedEntry

from atlas_scout.providers.base import Completion, Message
from atlas_scout.steps.entity_chase import (
    generate_followup_queries,
    select_entities_to_chase,
)


class _StubProvider:
    """Provider stub that returns a canned text response."""

    def __init__(self, response_text: str = "[]", *, raise_exc: Exception | None = None) -> None:
        self._response_text = response_text
        self._raise_exc = raise_exc
        self.max_concurrent = 4
        self.calls: list[list[Message]] = []

    async def complete(
        self,
        messages: list[Message],
        _response_schema: object = None,
    ) -> Completion:
        self.calls.append(messages)
        if self._raise_exc is not None:
            raise self._raise_exc
        return Completion(text=self._response_text)


def _ranked(name: str = "Org A", website: str = "https://a.example") -> RankedEntry:
    return RankedEntry(
        entry=DeduplicatedEntry(
            name=name,
            entry_type="organization",
            description="An org.",
            city="Austin",
            state="TX",
            issue_areas=["housing_affordability", "tenant_rights"],
            source_urls=["https://example.com/a"],
            source_dates=[date(2026, 1, 1)],
            source_contexts={"https://example.com/a": "context"},
            last_seen=date(2026, 1, 1),
            website=website,
        ),
        score=0.9,
    )


def _gap_report() -> GapReport:
    return GapReport(
        location="Austin, TX",
        covered_issues=["housing_affordability"],
        thin_issues=["tenant_rights"],
        missing_issues=["education_equity"],
        uncovered_domains=[],
        suggested_queries=[],
    )


@pytest.mark.asyncio
async def test_generate_followup_queries_parses_array() -> None:
    """A well-formed JSON array is parsed into SearchQuery objects."""
    payload = json.dumps(
        [
            {"query": "Austin housing nonprofits", "issue_area": "housing_affordability"},
            {"query": "Austin tenant rights org"},
        ]
    )
    provider = _StubProvider(response_text=payload)

    queries = await generate_followup_queries(
        provider,
        location="Austin, TX",
        issues=["housing_affordability", "tenant_rights"],
        gap_report=_gap_report(),
        existing_entries=[_ranked()],
    )

    assert len(queries) == 2
    assert queries[0].query == "Austin housing nonprofits"
    assert queries[0].issue_area == "housing_affordability"
    assert queries[0].source_category == "llm_followup"
    assert queries[1].issue_area == ""


@pytest.mark.asyncio
async def test_generate_followup_queries_handles_code_fenced_response() -> None:
    """The parser strips Markdown code fences before parsing JSON."""
    payload = "```json\n" + json.dumps([{"query": "q1"}]) + "\n```"
    provider = _StubProvider(response_text=payload)

    queries = await generate_followup_queries(
        provider,
        location="Austin, TX",
        issues=["x"],
        gap_report=_gap_report(),
        existing_entries=[],
    )

    assert len(queries) == 1


@pytest.mark.asyncio
async def test_generate_followup_queries_with_invalid_json_returns_empty() -> None:
    """Malformed JSON yields an empty list, not an exception."""
    provider = _StubProvider(response_text="this is not JSON")

    queries = await generate_followup_queries(
        provider,
        location="Austin, TX",
        issues=[],
        gap_report=_gap_report(),
        existing_entries=[],
    )

    assert queries == []


@pytest.mark.asyncio
async def test_generate_followup_queries_with_non_list_returns_empty() -> None:
    """A JSON object (not array) is rejected and returns empty."""
    provider = _StubProvider(response_text=json.dumps({"foo": "bar"}))

    queries = await generate_followup_queries(
        provider,
        location="Austin, TX",
        issues=[],
        gap_report=_gap_report(),
        existing_entries=[],
    )

    assert queries == []


@pytest.mark.asyncio
async def test_generate_followup_queries_skips_non_dict_items_and_missing_query() -> None:
    """Non-dict items and dicts without a 'query' field are skipped."""
    payload = json.dumps([
        "not-a-dict",
        {"issue_area": "no_query"},
        {"query": "ok"},
    ])
    provider = _StubProvider(response_text=payload)

    queries = await generate_followup_queries(
        provider,
        location="Austin, TX",
        issues=[],
        gap_report=_gap_report(),
        existing_entries=[],
    )

    assert len(queries) == 1
    assert queries[0].query == "ok"


@pytest.mark.asyncio
async def test_generate_followup_queries_returns_empty_on_provider_error(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A provider exception is logged and yields an empty list."""
    provider = _StubProvider(raise_exc=RuntimeError("provider boom"))

    with caplog.at_level("WARNING", logger="atlas_scout.steps.entity_chase"):
        queries = await generate_followup_queries(
            provider,
            location="Austin, TX",
            issues=[],
            gap_report=_gap_report(),
            existing_entries=[],
        )

    assert queries == []


@pytest.mark.asyncio
async def test_generate_followup_queries_includes_empty_gap_sections() -> None:
    """An empty gap report still produces a valid prompt."""
    provider = _StubProvider(response_text="[]")

    queries = await generate_followup_queries(
        provider,
        location="Austin, TX",
        issues=[],
        gap_report=GapReport(
            location="Austin, TX",
            covered_issues=[],
            thin_issues=[],
            missing_issues=[],
            uncovered_domains=[],
            suggested_queries=[],
        ),
        existing_entries=[],
    )

    assert queries == []
    # Sanity: 'none' appears for each empty gap section.
    user_msg = provider.calls[0][1].content
    assert "Covered issues (3+ entries): none" in user_msg


@pytest.mark.asyncio
async def test_select_entities_to_chase_parses_array() -> None:
    """A well-formed JSON array is parsed into chase target dicts."""
    payload = json.dumps(
        [
            {
                "name": "Org A",
                "website": "https://a.example",
                "search_query": "Org A staff",
            },
            {"name": "Org B"},
        ]
    )
    provider = _StubProvider(response_text=payload)

    targets = await select_entities_to_chase(provider, entries=[_ranked()])

    assert len(targets) == 2
    assert targets[0]["name"] == "Org A"
    assert targets[0]["website"] == "https://a.example"
    assert targets[1]["website"] == ""


@pytest.mark.asyncio
async def test_select_entities_to_chase_with_invalid_json_returns_empty() -> None:
    """Non-JSON output yields an empty list."""
    provider = _StubProvider(response_text="not json")

    targets = await select_entities_to_chase(provider, entries=[_ranked()])

    assert targets == []


@pytest.mark.asyncio
async def test_select_entities_to_chase_with_non_list_returns_empty() -> None:
    """A JSON object is rejected when an array is expected."""
    provider = _StubProvider(response_text=json.dumps({"name": "X"}))

    targets = await select_entities_to_chase(provider, entries=[_ranked()])

    assert targets == []


@pytest.mark.asyncio
async def test_select_entities_to_chase_skips_non_dict_and_missing_name() -> None:
    """Items without a 'name' field are skipped."""
    payload = json.dumps([
        "string",
        {"website": "no-name"},
        {"name": "Real Org"},
    ])
    provider = _StubProvider(response_text=payload)

    targets = await select_entities_to_chase(provider, entries=[_ranked()])

    assert len(targets) == 1
    assert targets[0]["name"] == "Real Org"


@pytest.mark.asyncio
async def test_select_entities_to_chase_returns_empty_on_provider_error(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A provider exception yields an empty list."""
    provider = _StubProvider(raise_exc=RuntimeError("nope"))

    with caplog.at_level("WARNING", logger="atlas_scout.steps.entity_chase"):
        targets = await select_entities_to_chase(provider, entries=[_ranked()])

    assert targets == []


@pytest.mark.asyncio
async def test_select_entities_to_chase_includes_entry_without_website() -> None:
    """Entries with no website still produce a valid prompt line (website='')."""
    entry = _ranked(website="")
    provider = _StubProvider(response_text="[]")

    targets = await select_entities_to_chase(provider, entries=[entry])

    assert targets == []
    user_msg = provider.calls[0][1].content
    assert "website=" in user_msg
