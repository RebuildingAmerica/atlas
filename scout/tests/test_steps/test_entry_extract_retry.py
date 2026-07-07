"""Tests for Step 3: entry_extract."""

from __future__ import annotations

import json
from typing import Any

import pytest
from atlas_shared import PageContent

from atlas_scout.providers.base import Completion, Message
from atlas_scout.steps.entry_extract import ExtractionFailedError, extract_entries_stream

from .test_entry_extract import _make_entry_json, _pages_iter


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
