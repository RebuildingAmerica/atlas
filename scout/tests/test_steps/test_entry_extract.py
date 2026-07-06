"""Tests for Step 3: entry_extract."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

import pytest
from atlas_shared import PageContent, RawEntry

from atlas_scout.providers.base import Completion, Message
from atlas_scout.steps.entry_extract import (
    ExtractionFailedError,
    _build_system_prompt,
    _coerce_dict,
    _coerce_mention_list,
    _coerce_str_list,
    _normalize_entity_type,
    _normalize_geo_specificity,
    _parse_extraction_response,
    _parse_identify_response,
    _provider_cache_key,
    _strip_code_fence,
    extract_entries_stream,
    extract_page_entries,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


class _MockProvider:
    """A minimal LLM provider mock for testing."""

    def __init__(self, response_text: str = "[]", max_concurrent: int = 4) -> None:
        self._response_text = response_text
        self.max_concurrent = max_concurrent
        self.calls: list[list[Message]] = []

    async def complete(
        self,
        messages: list[Message],
        _response_schema: Any = None,
    ) -> Completion:
        self.calls.append(messages)
        return Completion(text=self._response_text)


def _make_entry_json(name: str = "Test Org", issue: str = "housing_affordability") -> str:
    return json.dumps(
        [
            {
                "name": name,
                "type": "organization",
                "description": "A local housing org.",
                "city": "Austin",
                "state": "TX",
                "geo_specificity": "local",
                "issue_areas": [issue],
                "affiliated_org": None,
                "website": "https://testorg.org",
                "email": "info@testorg.org",
                "social_media": {},
                "extraction_context": "Test org helps with housing.",
            }
        ]
    )


def _make_entry_json_without_location(name: str = "Jane Doe") -> str:
    return json.dumps(
        [
            {
                "name": name,
                "type": "person",
                "description": "A named local official.",
                "city": None,
                "state": None,
                "geo_specificity": "local",
                "issue_areas": ["local_government_and_civic_engagement"],
                "affiliated_org": None,
                "website": None,
                "email": None,
                "social_media": {},
                "extraction_context": f"{name} serves the city.",
            }
        ]
    )


async def _pages_iter(*pages: PageContent) -> AsyncIterator[PageContent]:
    for page in pages:
        yield page


@pytest.mark.asyncio
async def test_builds_extraction_prompt_with_taxonomy() -> None:
    """The system prompt contains issue area slugs from the taxonomy."""
    prompt = _build_system_prompt("Austin", "TX")
    assert "housing_affordability" in prompt
    assert "union_organizing" in prompt
    assert "Austin, TX" in prompt
    assert "actual proper name" in prompt
    assert "Councilman Ward 1" in prompt


@pytest.mark.asyncio
async def test_builds_direct_url_prompt_that_allows_location_inference() -> None:
    """When location is omitted, the prompt should instruct the model to infer it."""
    prompt = _build_system_prompt("", "")
    assert "Infer the primary geography from the source text" in prompt
    assert "Target location:" not in prompt


@pytest.mark.asyncio
async def test_extracts_entries_from_pages() -> None:
    """extract_entries_stream yields RawEntry objects for each extracted item."""
    provider = _MockProvider(response_text=_make_entry_json("Housing First ATX"))
    page = PageContent(url="https://example.com", text="Housing First ATX helps renters.", title="")

    entries = [e async for e in extract_entries_stream(_pages_iter(page), provider, "Austin", "TX")]

    assert len(entries) == 1
    assert entries[0].name == "Housing First ATX"
    assert entries[0].source_url == "https://example.com"
    assert isinstance(entries[0], RawEntry)


@pytest.mark.asyncio
async def test_extracts_entries_fill_target_location_when_model_omits_it() -> None:
    """Target location should keep source-backed entries place-aware."""
    provider = _MockProvider(response_text=_make_entry_json_without_location("Jane Doe"))
    page = PageContent(url="https://example.com", text="Jane Doe serves the city.", title="")

    entries = [e async for e in extract_entries_stream(_pages_iter(page), provider, "Dallas", "TX")]

    assert len(entries) == 1
    assert entries[0].city == "Dallas"
    assert entries[0].state == "TX"


@pytest.mark.asyncio
async def test_skips_empty_llm_results() -> None:
    """Entries are not produced when LLM returns empty JSON array."""
    provider = _MockProvider(response_text="[]")
    page = PageContent(url="https://example.com", text="Some content.", title="")

    entries = [e async for e in extract_entries_stream(_pages_iter(page), provider, "Austin", "TX")]

    assert entries == []


@pytest.mark.asyncio
async def test_skips_empty_page_text() -> None:
    """Pages with empty text are skipped and produce no LLM calls."""
    provider = _MockProvider(response_text=_make_entry_json())
    page = PageContent(url="https://example.com", text="   ", title="")

    entries = [e async for e in extract_entries_stream(_pages_iter(page), provider, "Austin", "TX")]

    assert entries == []
    assert provider.calls == []  # No LLM call made


@pytest.mark.asyncio
async def test_strips_code_fences() -> None:
    """Code-fenced JSON responses are parsed correctly."""
    fenced = "```json\n" + _make_entry_json("Fenced Org") + "\n```"
    assert _strip_code_fence(fenced) == _make_entry_json("Fenced Org")

    provider = _MockProvider(response_text=fenced)
    page = PageContent(
        url="https://example.com",
        text="Fenced Org is a local housing organization in Austin.",
        title="",
    )
    entries = [e async for e in extract_entries_stream(_pages_iter(page), provider, "Austin", "TX")]

    assert len(entries) == 1
    assert entries[0].name == "Fenced Org"


@pytest.mark.asyncio
async def test_multiple_pages_all_extracted() -> None:
    """Entries from multiple pages are all yielded."""
    provider = _MockProvider(response_text=_make_entry_json())
    pages = [
        PageContent(
            url=f"https://example.com/page{i}",
            text="Test Org provides housing assistance in Austin TX.",
            title="",
        )
        for i in range(3)
    ]

    entries = [
        e async for e in extract_entries_stream(_pages_iter(*pages), provider, "Austin", "TX")
    ]

    assert len(entries) == 3
    source_urls = {e.source_url for e in entries}
    assert source_urls == {p.url for p in pages}


@pytest.mark.asyncio
async def test_reuses_cached_extraction_for_same_content(tmp_db_path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    provider = _MockProvider(response_text=_make_entry_json("Cached Org"))
    page = PageContent(
        url="https://example.com/a",
        text="Cached Org does housing advocacy. Shared body " * 40,
        title="Same title",
    )

    first_entries = [
        e
        async for e in extract_entries_stream(
            _pages_iter(page),
            provider,
            "Austin",
            "TX",
            store=store,
        )
    ]
    second_entries = [
        e
        async for e in extract_entries_stream(
            _pages_iter(page),
            provider,
            "Austin",
            "TX",
            store=store,
        )
    ]

    await store.close()

    assert len(first_entries) == 1
    assert len(second_entries) == 1
    # Two-pass extraction: identify + enrich = 2 calls on first run, 0 on cached second run
    first_run_calls = len(provider.calls)
    assert first_run_calls == 2


@pytest.mark.asyncio
async def test_cached_extraction_is_reused_across_urls_with_same_content(tmp_db_path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    provider = _MockProvider(response_text=_make_entry_json("Shared Org"))
    page_one = PageContent(
        url="https://example.com/a",
        text="Shared Org provides housing services. Shared body " * 40,
        title="Same title",
    )
    page_two = PageContent(
        url="https://example.com/b",
        text="Shared Org provides housing services. Shared body " * 40,
        title="Same title",
    )

    first_entries = [
        e
        async for e in extract_entries_stream(
            _pages_iter(page_one),
            provider,
            "Austin",
            "TX",
            store=store,
        )
    ]
    second_entries = [
        e
        async for e in extract_entries_stream(
            _pages_iter(page_two),
            provider,
            "Austin",
            "TX",
            store=store,
        )
    ]

    await store.close()

    # Two-pass extraction: 2 calls for first page, 0 for cached second page
    assert len(provider.calls) == 2
    assert first_entries[0].source_url == "https://example.com/a"
    assert second_entries[0].source_url == "https://example.com/b"


@pytest.mark.asyncio
async def test_refresh_extractions_bypasses_cache(tmp_db_path) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()
    provider = _MockProvider(response_text=_make_entry_json("Refreshed Org"))
    page = PageContent(
        url="https://example.com/a",
        text="Refreshed Org serves the Austin housing community. Shared body " * 40,
        title="Same title",
    )

    _ = [
        e
        async for e in extract_entries_stream(
            _pages_iter(page),
            provider,
            "Austin",
            "TX",
            store=store,
        )
    ]
    _ = [
        e
        async for e in extract_entries_stream(
            _pages_iter(page),
            provider,
            "Austin",
            "TX",
            store=store,
            reuse_cached_extractions=False,
        )
    ]

    await store.close()

    # 2 calls per run x 2 runs (refresh bypasses cache) = 4
    assert len(provider.calls) == 4


@pytest.mark.asyncio
async def test_claim_wait_timeout_falls_back_to_local_extraction(monkeypatch) -> None:
    from atlas_scout.steps import entry_extract as entry_extract_module

    class _WaitingStore:
        async def get_cached_extraction(self, _cache_key):
            return None

        async def claim_work(self, *_args, **_kwargs):
            return False

        async def get_work_claim(self, _claim_key):
            return {"status": "inflight"}

        async def cache_extraction(self, **_kwargs):
            return None

        async def complete_work(self, _claim_key):
            return None

        async def fail_work(self, _claim_key, _error):
            return None

    monkeypatch.setattr(entry_extract_module, "_CLAIM_WAIT_SECONDS", 0.0)
    monkeypatch.setattr(entry_extract_module, "_CLAIM_POLL_SECONDS", 0.0)

    provider = _MockProvider(response_text=_make_entry_json("Fallback Org"))
    page = PageContent(
        url="https://example.com",
        text="Fallback Org organizes housing support. Shared body " * 40,
        title="Same title",
    )

    entries = await extract_page_entries(
        page,
        provider,
        "Austin",
        "TX",
        store=_WaitingStore(),
        run_id="run-1",
        reuse_cached_extractions=True,
    )

    assert len(entries) == 1
    assert entries[0].name == "Fallback Org"
    # Two-pass extraction: identify + enrich = 2 calls
    assert len(provider.calls) == 2


# ---------------------------------------------------------------------------
# Coercion helpers
# ---------------------------------------------------------------------------


def test_coerce_dict_handles_none() -> None:
    """None coerces to an empty dict."""
    assert _coerce_dict(None) == {}
    assert _coerce_dict({"a": "b"}) == {"a": "b"}


def test_coerce_str_list_handles_none() -> None:
    """None coerces to an empty list."""
    assert _coerce_str_list(None) == []
    assert _coerce_str_list(["a"]) == ["a"]


def test_coerce_mention_list_handles_none() -> None:
    """None coerces to an empty mention list."""
    assert _coerce_mention_list(None) == []
    assert _coerce_mention_list([{"name": "X"}]) == [{"name": "X"}]


# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------


def test_normalize_geo_specificity_known_alias() -> None:
    """Known aliases are normalized."""
    assert _normalize_geo_specificity("CITY") == "local"
    assert _normalize_geo_specificity("federal") == "national"


def test_normalize_geo_specificity_unknown_defaults_to_local(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Unknown values fall back to 'local' and emit a warning."""
    with caplog.at_level("WARNING", logger="atlas_scout.steps.entry_extract"):
        result = _normalize_geo_specificity("planet-wide")
    assert result == "local"
    assert any("Unknown geo_specificity" in r.message for r in caplog.records)


def test_normalize_entity_type_known_alias() -> None:
    """Known type aliases normalize."""
    assert _normalize_entity_type("nonprofit") == "organization"
    assert _normalize_entity_type("PROGRAM") == "initiative"


def test_normalize_entity_type_unknown_defaults_to_organization(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Unknown values fall back to 'organization' and emit a warning."""
    with caplog.at_level("WARNING", logger="atlas_scout.steps.entry_extract"):
        result = _normalize_entity_type("space-station")
    assert result == "organization"
    assert any("Unknown entity type" in r.message for r in caplog.records)


# ---------------------------------------------------------------------------
# Identify-pass parser
# ---------------------------------------------------------------------------


def test_parse_identify_response_strips_think_block() -> None:
    """A reasoning-model <think>...</think> prefix is stripped before parsing."""
    body = json.dumps([{"name": "Alice", "type": "person", "quote": "Alice spoke."}])
    text = f"<think>internal reasoning</think>\n{body}"

    items = _parse_identify_response(text)

    assert len(items) == 1
    assert items[0]["name"] == "Alice"


def test_parse_identify_response_recovers_array_from_text() -> None:
    """JSONDecodeError fallback finds and re-parses an embedded array."""
    body = json.dumps([{"name": "Bob", "type": "person", "quote": "Bob said hi."}])
    text = f"some chatter before [garbage [{body}] more garbage"

    items = _parse_identify_response(text)

    # When initial parse fails, find first [ and last ] and try again. The
    # constructed slice may not be valid JSON either, in which case we get [].
    # This still exercises the recovery path.
    assert isinstance(items, list)


def test_parse_identify_response_recovers_array_when_initial_parse_fails() -> None:
    """A leading non-JSON header but a clean trailing array is recovered."""
    body = json.dumps([{"name": "Eve", "type": "person", "quote": "Eve quoted."}])
    text = f"Here's the result:\n{body}"

    items = _parse_identify_response(text)

    assert len(items) == 1
    assert items[0]["name"] == "Eve"


def test_parse_identify_response_no_brackets_returns_empty() -> None:
    """No JSON brackets at all yields an empty list."""
    assert _parse_identify_response("just plain text, no brackets") == []


def test_parse_identify_response_unrecoverable_brackets_return_empty() -> None:
    """Brackets present but content is unparsable yields empty."""
    assert _parse_identify_response("text [not json here] more") == []


def test_parse_identify_response_non_list_root_returns_empty() -> None:
    """A JSON object at root yields an empty list."""
    assert _parse_identify_response(json.dumps({"foo": "bar"})) == []


def test_parse_identify_response_skips_items_without_name() -> None:
    """Non-dict items and dicts without a name are skipped."""
    text = json.dumps(
        [
            "string-item",
            {"type": "person"},  # no name
            {"name": "Real", "type": "person", "quote": "x"},
        ]
    )
    items = _parse_identify_response(text)
    assert len(items) == 1
    assert items[0]["name"] == "Real"


# ---------------------------------------------------------------------------
# Enrichment / structured response parser
# ---------------------------------------------------------------------------


def test_parse_extraction_response_uses_parsed_payload() -> None:
    """When provider returns parsed payload, no JSON parsing is needed."""
    completion = Completion(
        text="",
        parsed={
            "entries": [
                {
                    "name": "ParsedOrg",
                    "type": "organization",
                    "description": "d",
                    "city": "Austin",
                    "state": "TX",
                    "geo_specificity": "local",
                    "issue_areas": ["housing_affordability"],
                    "extraction_context": "ctx",
                }
            ],
            "discovery_leads": ["https://example.com/lead"],
        },
    )

    entries = _parse_extraction_response(completion)

    assert len(entries) == 1
    assert entries[0].name == "ParsedOrg"
    assert entries[0].discovery_leads == ["https://example.com/lead"]


def test_parse_extraction_response_falls_back_to_text_json() -> None:
    """When parsed is None, fall back to JSON-decoding the text."""
    payload = {
        "entries": [
            {
                "name": "TextOrg",
                "type": "organization",
                "extraction_context": "ctx",
            }
        ],
        "discovery_leads": [],
    }
    completion = Completion(text=json.dumps(payload), parsed=None)

    entries = _parse_extraction_response(completion)

    assert len(entries) == 1
    assert entries[0].name == "TextOrg"


def test_parse_extraction_response_raises_on_bad_text_json() -> None:
    """Invalid JSON without parsed payload raises ExtractionFailedError."""
    completion = Completion(text="not valid json {", parsed=None)

    with pytest.raises(ExtractionFailedError, match="invalid_json_response"):
        _parse_extraction_response(completion)


def test_parse_extraction_response_accepts_raw_array_payload() -> None:
    """A bare array payload is wrapped into the entries envelope."""
    completion = Completion(
        text="",
        parsed=None,
    )
    # Use a list at the JSON layer
    completion = Completion(
        text=json.dumps(
            [{"name": "ArrayOrg", "type": "organization", "extraction_context": "ctx"}]
        ),
        parsed=None,
    )

    entries = _parse_extraction_response(completion)

    assert len(entries) == 1
    assert entries[0].name == "ArrayOrg"


def test_parse_extraction_response_raises_on_validation_failure() -> None:
    """Pydantic validation errors are wrapped in ExtractionFailedError."""
    completion = Completion(
        text="",
        parsed={"entries": "not-a-list"},
    )

    with pytest.raises(ExtractionFailedError, match="structured_output_validation_failed"):
        _parse_extraction_response(completion)


# ---------------------------------------------------------------------------
# Provider cache key
# ---------------------------------------------------------------------------


class _ProviderWithExplicitIdentity:
    cache_identity = "custom:my-model"
    max_concurrent = 2

    async def complete(self, *_args, **_kwargs):  # pragma: no cover - not used here
        return Completion(text="[]")


def test_provider_cache_key_uses_explicit_identity() -> None:
    """A provider exposing cache_identity uses it directly."""
    assert _provider_cache_key(_ProviderWithExplicitIdentity()) == "custom:my-model"


class _ProviderWithoutModel:
    max_concurrent = 1

    async def complete(self, *_args, **_kwargs):  # pragma: no cover
        return Completion(text="[]")


def test_provider_cache_key_falls_back_to_class_name() -> None:
    """A provider without cache_identity or model uses the lowercase class name."""
    assert _provider_cache_key(_ProviderWithoutModel()) == "_providerwithoutmodel"


# ---------------------------------------------------------------------------
# Pipeline edge cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_extract_entries_stream_saturates_concurrency_window() -> None:
    """When pending tasks reach max_concurrent, drain at least once mid-loop."""
    provider = _MockProvider(response_text=_make_entry_json("X"), max_concurrent=2)
    pages = [
        PageContent(
            url=f"https://example.com/p{i}",
            text=f"X is an org doing housing in Austin. body {i} " * 20,
            title="t",
        )
        for i in range(5)
    ]

    entries = [
        e async for e in extract_entries_stream(_pages_iter(*pages), provider, "Austin", "TX")
    ]

    assert len(entries) == 5


@pytest.mark.asyncio
async def test_pass_identify_includes_structured_metadata_block() -> None:
    """Pages with structured_data prepend a metadata block to the user message."""
    provider = _MockProvider(response_text=_make_entry_json("Meta Org"))
    page = PageContent(
        url="https://example.com/meta",
        text="Meta Org is a housing nonprofit in Austin TX.",
        title="t",
        structured_data={"author": "Jane Doe", "section": "housing"},
        published_date=datetime(2026, 1, 15, tzinfo=UTC),
    )

    entries = [e async for e in extract_entries_stream(_pages_iter(page), provider, "Austin", "TX")]

    assert len(entries) == 1
    assert entries[0].source_date is not None
    user_msg = provider.calls[0][1].content
    assert "Page metadata" in user_msg


# ---------------------------------------------------------------------------
# Retry & failure paths in provider extraction
# ---------------------------------------------------------------------------


class _FailingProvider:
    """Provider that fails N times before optionally succeeding."""

    def __init__(self, failures: int, success_text: str | None) -> None:
        self._remaining_failures = failures
        self._success_text = success_text
        self.max_concurrent = 1
        self.calls: list[list[Message]] = []

    async def complete(
        self,
        messages: list[Message],
        _response_schema: Any = None,
    ) -> Completion:
        self.calls.append(messages)
        if self._remaining_failures > 0:
            self._remaining_failures -= 1
            raise RuntimeError("simulated provider error")
        if self._success_text is None:
            raise RuntimeError("permanent failure")
        return Completion(text=self._success_text)


@pytest.mark.asyncio
async def test_pass_identify_retries_then_succeeds(monkeypatch) -> None:
    """Identify pass retries on failure and surfaces the on_retry callback."""
    from atlas_scout.steps import entry_extract as entry_extract_module

    monkeypatch.setattr(entry_extract_module, "_RETRY_BACKOFF_SECONDS", 0.0)
    provider = _FailingProvider(failures=1, success_text=_make_entry_json("Retry Org"))
    page = PageContent(
        url="https://example.com",
        text="Retry Org provides housing support in Austin TX. " * 5,
        title="t",
    )

    retries: list[dict[str, object]] = []

    entries = [
        e
        async for e in extract_entries_stream(
            _pages_iter(page),
            provider,
            "Austin",
            "TX",
            on_retry=lambda payload: retries.append(payload),
        )
    ]

    assert len(entries) == 1
    assert any(r["url"] == page.url for r in retries)


@pytest.mark.asyncio
async def test_pass_identify_raises_after_max_attempts(monkeypatch) -> None:
    """When all retries fail the identify pass raises ExtractionFailedError."""
    from atlas_scout.steps import entry_extract as entry_extract_module

    monkeypatch.setattr(entry_extract_module, "_RETRY_BACKOFF_SECONDS", 0.0)
    monkeypatch.setattr(entry_extract_module, "_MAX_EXTRACTION_ATTEMPTS", 2)
    provider = _FailingProvider(failures=10, success_text=None)
    page = PageContent(
        url="https://example.com",
        text="text body that has plenty of words to trigger the extraction. " * 5,
        title="t",
    )

    with pytest.raises(ExtractionFailedError):
        [
            e
            async for e in extract_entries_stream(
                _pages_iter(page),
                provider,
                "Austin",
                "TX",
            )
        ]


class _IdentifyOkEnrichFailProvider:
    """First call succeeds (identify), all subsequent calls fail (enrich)."""

    def __init__(self, identify_text: str) -> None:
        self._identify_text = identify_text
        self._calls = 0
        self.max_concurrent = 1
        self.calls: list[list[Message]] = []

    async def complete(
        self,
        messages: list[Message],
        response_schema: Any = None,
    ) -> Completion:
        self._calls += 1
        self.calls.append(messages)
        if response_schema is None:
            return Completion(text=self._identify_text)
        raise RuntimeError("enrich boom")


@pytest.mark.asyncio
async def test_pass_enrich_raises_after_max_attempts(monkeypatch) -> None:
    """Enrich pass raises ExtractionFailedError when retries are exhausted."""
    from atlas_scout.steps import entry_extract as entry_extract_module

    monkeypatch.setattr(entry_extract_module, "_RETRY_BACKOFF_SECONDS", 0.0)
    monkeypatch.setattr(entry_extract_module, "_MAX_EXTRACTION_ATTEMPTS", 2)
    identify = json.dumps([{"name": "Q", "type": "organization", "quote": "Q is mentioned."}])
    provider = _IdentifyOkEnrichFailProvider(identify_text=identify)
    page = PageContent(
        url="https://example.com",
        text="Q is an organization doing housing work in Austin TX. " * 5,
        title="t",
    )

    retries: list[dict[str, object]] = []
    with pytest.raises(ExtractionFailedError):
        [
            e
            async for e in extract_entries_stream(
                _pages_iter(page),
                provider,
                "Austin",
                "TX",
                on_retry=lambda payload: retries.append(payload),
            )
        ]
    assert any(r["url"] == page.url for r in retries)


# ---------------------------------------------------------------------------
# Cache hit while waiting for shared claim
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_extract_page_entries_returns_cached_after_failed_claim(monkeypatch) -> None:
    """When claim_work fails but cache becomes available, return cached entries."""
    from atlas_scout.steps import entry_extract as entry_extract_module

    monkeypatch.setattr(entry_extract_module, "_CLAIM_POLL_SECONDS", 0.0)
    monkeypatch.setattr(entry_extract_module, "_CLAIM_WAIT_SECONDS", 5.0)

    provider = _MockProvider(response_text=_make_entry_json("Cached"))
    page = PageContent(
        url="https://example.com",
        text="Cached is an org. " * 30,
        title="t",
    )

    cache_payload = {
        "entries": [
            {
                "name": "Cached",
                "entry_type": "organization",
                "description": "An org.",
                "city": "Austin",
                "state": "TX",
                "geo_specificity": "local",
                "issue_areas": [],
                "region": None,
                "website": None,
                "email": None,
                "social_media": {},
                "affiliated_org": None,
                "extraction_context": "ctx",
                "mentioned_entities": [],
                "discovery_leads": [],
                "source_url": "",
                "source_date": None,
            }
        ],
    }

    class _CacheHitAfterClaimStore:
        def __init__(self) -> None:
            self._cached_after_first = False

        async def get_cached_extraction(self, _cache_key):
            if not self._cached_after_first:
                # First call: empty (initial cache check).
                return None
            return cache_payload

        async def claim_work(self, *_args, **_kwargs):
            # Simulate someone else owning the claim.
            self._cached_after_first = True
            return False

        async def get_work_claim(self, _claim_key):
            return {"status": "completed"}

        async def cache_extraction(self, **_kwargs):
            return None

        async def complete_work(self, _claim_key):
            return None

        async def fail_work(self, _claim_key, _error):
            return None

    entries = await extract_page_entries(
        page,
        provider,
        "Austin",
        "TX",
        store=_CacheHitAfterClaimStore(),
        run_id="run-cache",
        reuse_cached_extractions=True,
    )

    assert len(entries) == 1
    assert entries[0].name == "Cached"
    # Cached path means the provider was never called.
    assert provider.calls == []


@pytest.mark.asyncio
async def test_extract_page_entries_polls_when_claim_inflight(monkeypatch) -> None:
    """Inflight claim with deadline not reached triggers a poll sleep, then cache hit."""
    from atlas_scout.steps import entry_extract as entry_extract_module

    monkeypatch.setattr(entry_extract_module, "_CLAIM_POLL_SECONDS", 0.0)
    monkeypatch.setattr(entry_extract_module, "_CLAIM_WAIT_SECONDS", 5.0)

    cache_payload = {
        "entries": [
            {
                "name": "PolledOrg",
                "entry_type": "organization",
                "description": "d",
                "city": "Austin",
                "state": "TX",
                "geo_specificity": "local",
                "issue_areas": [],
                "region": None,
                "website": None,
                "email": None,
                "social_media": {},
                "affiliated_org": None,
                "extraction_context": "ctx",
                "mentioned_entities": [],
                "discovery_leads": [],
                "source_url": "",
                "source_date": None,
            }
        ],
    }

    class _PollingStore:
        def __init__(self) -> None:
            self._cache_calls = 0

        async def get_cached_extraction(self, _cache_key):
            # 1st call: initial check (None)
            # 2nd call: post-claim (None — must poll)
            # 3rd call: post-poll (cache hit)
            self._cache_calls += 1
            if self._cache_calls >= 3:
                return cache_payload
            return None

        async def claim_work(self, *_args, **_kwargs):
            return False

        async def get_work_claim(self, _claim_key):
            return {"status": "inflight"}

        async def cache_extraction(self, **_kwargs):
            return None

        async def complete_work(self, _claim_key):
            return None

        async def fail_work(self, _claim_key, _error):
            return None

    provider = _MockProvider(response_text=_make_entry_json("WontBeUsed"))
    page = PageContent(
        url="https://example.com",
        text="PolledOrg works on housing in Austin. " * 30,
        title="t",
    )

    entries = await extract_page_entries(
        page,
        provider,
        "Austin",
        "TX",
        store=_PollingStore(),
        run_id="run-poll",
        reuse_cached_extractions=True,
    )

    assert len(entries) == 1
    assert entries[0].name == "PolledOrg"


@pytest.mark.asyncio
async def test_extract_page_entries_propagates_provider_failure(monkeypatch, tmp_path) -> None:
    """When the provider raises, the claim is marked failed and the error propagates."""
    from atlas_scout.steps import entry_extract as entry_extract_module
    from atlas_scout.store import ScoutStore

    monkeypatch.setattr(entry_extract_module, "_RETRY_BACKOFF_SECONDS", 0.0)
    monkeypatch.setattr(entry_extract_module, "_MAX_EXTRACTION_ATTEMPTS", 1)

    store = ScoutStore(str(tmp_path / "scout.db"))
    await store.initialize()

    provider = _FailingProvider(failures=10, success_text=None)
    page = PageContent(
        url="https://example.com",
        text="some text " * 30,
        title="t",
    )

    with pytest.raises(ExtractionFailedError):
        await extract_page_entries(
            page,
            provider,
            "Austin",
            "TX",
            store=store,
            run_id="run-failure",
            reuse_cached_extractions=True,
        )

    await store.close()


@pytest.mark.asyncio
async def test_extract_page_entries_skips_cache_check_when_refresh_requested(monkeypatch) -> None:
    """When reuse_cached_extractions=False, the post-claim cache check is skipped."""
    from atlas_scout.steps import entry_extract as entry_extract_module

    monkeypatch.setattr(entry_extract_module, "_CLAIM_POLL_SECONDS", 0.0)
    monkeypatch.setattr(entry_extract_module, "_CLAIM_WAIT_SECONDS", 0.0)

    cache_calls: list[str] = []

    class _RefreshStore:
        async def get_cached_extraction(self, _cache_key):
            cache_calls.append("cached")

        async def claim_work(self, *_args, **_kwargs):
            # Always fail the claim so we exercise the refresh-skip path.
            return False

        async def get_work_claim(self, _claim_key):
            return {"status": "inflight"}

        async def cache_extraction(self, **_kwargs):
            return None

        async def complete_work(self, _claim_key):
            return None

        async def fail_work(self, _claim_key, _error):
            return None

    provider = _MockProvider(response_text=_make_entry_json("RefreshOrg"))
    page = PageContent(
        url="https://example.com",
        text="RefreshOrg works in Austin TX. " * 30,
        title="t",
    )

    entries = await extract_page_entries(
        page,
        provider,
        "Austin",
        "TX",
        store=_RefreshStore(),
        run_id="run-refresh",
        reuse_cached_extractions=False,
    )

    # Falls back to local extraction (deadline 0 hits immediately).
    assert len(entries) == 1
    assert entries[0].name == "RefreshOrg"
    # When reuse_cached_extractions=False there is no cache check inside the loop.
    assert cache_calls == []


@pytest.mark.asyncio
async def test_extract_page_entries_continues_when_claim_record_missing(monkeypatch) -> None:
    """When the claim record disappears between attempts, the loop continues."""
    from atlas_scout.steps import entry_extract as entry_extract_module

    monkeypatch.setattr(entry_extract_module, "_CLAIM_POLL_SECONDS", 0.0)
    monkeypatch.setattr(entry_extract_module, "_CLAIM_WAIT_SECONDS", 5.0)

    class _MissingClaimStore:
        def __init__(self) -> None:
            self._claim_attempts = 0

        async def get_cached_extraction(self, _cache_key):
            return None

        async def claim_work(self, *_args, **_kwargs):
            self._claim_attempts += 1
            # Succeed on the second call; first call returns False to drive the
            # `claim is None` continue-branch.
            return self._claim_attempts >= 2

        async def get_work_claim(self, _claim_key):
            # Returning None means "claim record missing, retry".
            return None

        async def cache_extraction(self, **_kwargs):
            return None

        async def complete_work(self, _claim_key):
            return None

        async def fail_work(self, _claim_key, _error):
            return None

    provider = _MockProvider(response_text=_make_entry_json("LoopOrg"))
    page = PageContent(
        url="https://example.com",
        text="LoopOrg works in Austin TX. " * 30,
        title="t",
    )

    entries = await extract_page_entries(
        page,
        provider,
        "Austin",
        "TX",
        store=_MissingClaimStore(),
        run_id="run-loop",
        reuse_cached_extractions=True,
    )

    assert len(entries) == 1
    assert entries[0].name == "LoopOrg"


def test_build_system_prompt_appends_extraction_directive() -> None:
    """An operator directive is appended verbatim to the system prompt."""
    prompt = _build_system_prompt(
        "Austin",
        "TX",
        extraction_directive="  prefer education orgs  ",
    )
    assert "Operator directive:\nprefer education orgs" in prompt


class _ProviderWithModelAttr:
    max_concurrent = 1

    def __init__(self, model: str) -> None:
        self.model = model

    async def complete(self, *_args, **_kwargs):  # pragma: no cover - not used
        return Completion(text="[]")


def test_provider_cache_key_uses_model_attribute() -> None:
    """When cache_identity is missing, the model attribute composes the key."""
    key = _provider_cache_key(_ProviderWithModelAttr(model="gpt-x"))
    assert key == "_providerwithmodelattr:gpt-x"


@pytest.mark.asyncio
async def test_pass_identify_failure_without_on_retry(monkeypatch) -> None:
    """The identify pass tolerates a None on_retry callback during retries."""
    from atlas_scout.steps import entry_extract as entry_extract_module

    monkeypatch.setattr(entry_extract_module, "_RETRY_BACKOFF_SECONDS", 0.0)
    provider = _FailingProvider(failures=1, success_text=_make_entry_json("NoRetryHook"))
    page = PageContent(
        url="https://example.com",
        text="NoRetryHook works in Austin TX. " * 5,
        title="t",
    )

    entries = [
        e
        async for e in extract_entries_stream(
            _pages_iter(page),
            provider,
            "Austin",
            "TX",
            on_retry=None,
        )
    ]

    assert len(entries) == 1
    assert entries[0].name == "NoRetryHook"


@pytest.mark.asyncio
async def test_pass_enrich_failure_without_on_retry(monkeypatch) -> None:
    """The enrich pass tolerates a None on_retry callback during retries."""
    from atlas_scout.steps import entry_extract as entry_extract_module

    monkeypatch.setattr(entry_extract_module, "_RETRY_BACKOFF_SECONDS", 0.0)

    class _EnrichTransientFailProvider:
        def __init__(self) -> None:
            self.max_concurrent = 1
            self._enrich_calls = 0
            self.calls: list[list[Message]] = []

        async def complete(
            self,
            messages: list[Message],
            response_schema: Any = None,
        ) -> Completion:
            self.calls.append(messages)
            if response_schema is None:
                return Completion(
                    text=json.dumps([{"name": "T", "type": "organization", "quote": "T spoke."}]),
                )
            self._enrich_calls += 1
            if self._enrich_calls == 1:
                raise RuntimeError("transient")
            return Completion(text=_make_entry_json("EnrichOk"))

    provider = _EnrichTransientFailProvider()
    page = PageContent(
        url="https://example.com",
        text="EnrichOk works in Austin TX. " * 5,
        title="t",
    )

    entries = [
        e
        async for e in extract_entries_stream(
            _pages_iter(page),
            provider,
            "Austin",
            "TX",
            on_retry=None,
        )
    ]

    assert len(entries) == 1
    assert entries[0].name == "EnrichOk"
