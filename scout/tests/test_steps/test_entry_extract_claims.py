"""Tests for Step 3: entry_extract."""

from __future__ import annotations

from typing import Any

import pytest
from atlas_shared import PageContent

from atlas_scout.providers.base import Completion, Message
from atlas_scout.steps.entry_extract import ExtractionFailedError, extract_page_entries

from .test_entry_extract import _make_entry_json, _MockProvider


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
