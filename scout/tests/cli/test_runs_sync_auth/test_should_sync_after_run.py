"""Behavior of sync-after-run decision logic."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest  # noqa: TC002

from atlas_scout.cli import _should_sync_after_run
from atlas_scout.config import ContributionConfig, ScoutConfig, StoreConfig

from .support import build_config, workspace_session

if TYPE_CHECKING:
    from pathlib import Path


def test_should_sync_after_run_defaults_to_logged_in_artifact_runs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Logged-in runs with canonical artifacts should sync without extra flags."""
    monkeypatch.setattr("atlas_scout.cli.load_session", workspace_session)

    assert (
        _should_sync_after_run(
            build_config(tmp_path),
            result_artifacts_available=True,
            sync_after_run=None,
        )
        is True
    )


def test_should_sync_after_run_skips_duplicates_and_missing_artifacts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Manual opt-out, API-key contribution mode, and missing artifacts should not auto-sync."""
    monkeypatch.setattr("atlas_scout.cli.load_session", workspace_session)

    assert (
        _should_sync_after_run(
            build_config(tmp_path),
            result_artifacts_available=True,
            sync_after_run=False,
        )
        is False
    )
    assert (
        _should_sync_after_run(
            ScoutConfig(
                contribution=ContributionConfig(
                    enabled=True,
                    api_key="key",
                    atlas_url="https://atlas.example",
                ),
                store=StoreConfig(path=str(tmp_path / "scout.db")),
            ),
            result_artifacts_available=True,
            sync_after_run=None,
        )
        is False
    )
    assert (
        _should_sync_after_run(
            build_config(tmp_path),
            result_artifacts_available=False,
            sync_after_run=None,
        )
        is False
    )
