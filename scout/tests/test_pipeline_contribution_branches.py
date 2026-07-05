"""Branch and edge-case tests for the Scout pipeline orchestrator."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest
from atlas_shared import PageContent

from atlas_scout import pipeline as pipeline_module
from atlas_scout.config import ContributionConfig
from atlas_scout.pipeline import run_pipeline
from atlas_scout.providers.base import Completion, Message
from atlas_scout.steps.contribute import ContributionResult

if TYPE_CHECKING:
    from pathlib import Path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _SeedFetcher:
    """A fetcher that returns a single PageContent for any URL."""

    def __init__(self, *, fetched_urls: list[str] | None = None) -> None:
        self.fetched_urls: list[str] = fetched_urls if fetched_urls is not None else []

    async def fetch_tracked(self, url: str, task_id: str, _store) -> PageContent | None:
        self.fetched_urls.append(url)
        return PageContent(
            url=url,
            title="Seed",
            text=("Tenant Defense Collective organizes tenants locally in Austin. " * 60),
            task_id=task_id,
        )


class _EmptyProvider:
    """LLM provider that always returns an empty extraction."""

    max_concurrent = 1

    async def complete(
        self,
        _messages: list[Message],
        _response_schema=None,
    ) -> Completion:
        return Completion(text="[]")


class _FlakyProgressProvider:
    """Provider that returns []; tests use a flaky on_progress callback."""

    max_concurrent = 1

    async def complete(
        self,
        _messages: list[Message],
        _response_schema=None,
    ) -> Completion:
        return Completion(text="[]")


class _OneEntryProvider:
    """Provider that identifies and enriches one source-backed organization."""

    max_concurrent = 1

    def __init__(self) -> None:
        self.calls = 0

    async def complete(
        self,
        messages: list[Message],
        _response_schema=None,
    ) -> Completion:
        self.calls += 1
        user_content = messages[1].content if len(messages) > 1 else ""
        if "IDENTIFIED ENTITIES" in user_content:
            return Completion(
                text=json.dumps(
                    {
                        "entries": [
                            {
                                "name": "Tenant Defense Collective",
                                "type": "organization",
                                "description": "Organizes tenants locally.",
                                "city": "Austin",
                                "state": "TX",
                                "geo_specificity": "local",
                                "issue_areas": ["housing_affordability"],
                                "website": "https://tenant.example",
                                "email": "hello@tenant.example",
                                "social_media": {},
                                "affiliated_org": None,
                                "extraction_context": (
                                    "Tenant Defense Collective organizes tenants."
                                ),
                            }
                        ]
                    }
                )
            )
        return Completion(
            text=(
                '[{"name": "Tenant Defense Collective", "type": "organization", '
                '"quote": "Tenant Defense Collective organizes tenants locally in Austin."}]'
            )
        )


# ---------------------------------------------------------------------------
# Progress callback exception path (lines 145-146)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_pipeline_syncs_artifacts_when_contribution_enabled(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    sync_calls: list[dict[str, object]] = []

    async def fake_sync_run_artifacts(
        _artifacts, *, atlas_url: str, api_key: str
    ) -> ContributionResult:
        sync_calls.append({"atlas_url": atlas_url, "api_key": api_key})
        return ContributionResult(
            attempted=1,
            created=1,
            failed=0,
            errors=[],
            run_id="remote-run-id",
            sync_status="synced",
            duplicate=False,
        )

    monkeypatch.setattr("atlas_scout.steps.contribute.sync_run_artifacts", fake_sync_run_artifacts)

    contribution = ContributionConfig(
        enabled=True,
        api_key="test-token",
        atlas_url="https://atlas.example",
        min_score=0.0,
    )

    async def _fake_search(*_args, **_kwargs):
        return [{"url": "https://example.com/result", "title": "x", "publication": "y"}]

    monkeypatch.setattr("atlas_scout.steps.source_fetch._search_brave", _fake_search)

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_OneEntryProvider(),
        store=store,
        search_api_key="test-key",
        fetcher=_SeedFetcher(),
        contribution_config=contribution,
        min_entry_score=0.0,
    )

    assert sync_calls == [{"atlas_url": "https://atlas.example", "api_key": "test-token"}]
    assert result.artifacts is not None
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_records_remote_run_id_for_worker_sync(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    async def _fake_search(*_args, **_kwargs):
        return [{"url": "https://example.com/result", "title": "x", "publication": "y"}]

    monkeypatch.setattr("atlas_scout.steps.source_fetch._search_brave", _fake_search)

    result = await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_OneEntryProvider(),
        store=store,
        search_api_key="test-key",
        fetcher=_SeedFetcher(),
        min_entry_score=0.0,
        remote_run_id="remote-run-123",
    )

    assert result.artifacts is not None
    assert result.artifacts.manifest.sync is not None
    assert result.artifacts.manifest.sync.remote_run_id == "remote-run-123"
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_records_sync_failure_when_sync_returns_errors(
    monkeypatch: pytest.MonkeyPatch, tmp_db_path: Path
) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    async def fake_sync_run_artifacts(
        _artifacts, *, atlas_url: str, api_key: str
    ) -> ContributionResult:
        del atlas_url, api_key
        return ContributionResult(
            attempted=1,
            created=0,
            failed=1,
            errors=["upstream rejected"],
            run_id=None,
            sync_status="failed",
        )

    monkeypatch.setattr("atlas_scout.steps.contribute.sync_run_artifacts", fake_sync_run_artifacts)

    contribution = ContributionConfig(
        enabled=True,
        api_key="test-token",
        atlas_url="https://atlas.example",
        min_score=0.0,
    )

    async def _fake_search(*_args, **_kwargs):
        return [{"url": "https://example.com/seed", "title": "x", "publication": "y"}]

    monkeypatch.setattr("atlas_scout.steps.source_fetch._search_brave", _fake_search)

    await run_pipeline(
        location="Austin, TX",
        issues=["housing_affordability"],
        provider=_EmptyProvider(),
        store=store,
        search_api_key="test-key",
        fetcher=_SeedFetcher(),
        contribution_config=contribution,
    )

    await store.close()


# ---------------------------------------------------------------------------
# Contribution warning when canonical metadata missing (line 874 / lines 837)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_pipeline_skips_artifact_persistence_in_direct_url_mode(
    tmp_db_path: Path,
) -> None:
    """Direct URL mode lacks canonical run metadata → artifacts are not persisted."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    result = await run_pipeline(
        location="",  # blank location → cannot build canonical artifacts
        issues=[],
        provider=_EmptyProvider(),
        store=store,
        direct_urls=["https://example.com/seed"],
        fetcher=_SeedFetcher(),
    )

    assert result.artifacts is None
    await store.close()


@pytest.mark.asyncio
async def test_run_pipeline_warns_when_contribution_enabled_without_canonical_metadata(
    caplog: pytest.LogCaptureFixture, tmp_db_path: Path
) -> None:
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(tmp_db_path))
    await store.initialize()

    contribution = ContributionConfig(
        enabled=True,
        api_key="test-token",
        atlas_url="https://atlas.example",
        min_score=0.0,
    )

    with caplog.at_level("WARNING", logger=pipeline_module.logger.name):
        await run_pipeline(
            location="",  # no canonical metadata
            issues=[],
            provider=_EmptyProvider(),
            store=store,
            direct_urls=["https://example.com/seed"],
            fetcher=_SeedFetcher(),
            contribution_config=contribution,
        )

    assert any("Skipping Atlas sync" in record.getMessage() for record in caplog.records)
    await store.close()


# ---------------------------------------------------------------------------
# Iterative deepening (lines 619-782)
# ---------------------------------------------------------------------------
