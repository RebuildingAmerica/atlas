"""Shared helpers for Scout run sync auth tests."""

from __future__ import annotations

import io
from typing import TYPE_CHECKING

from atlas_shared import (
    DiscoveryRunArtifacts,
    DiscoveryRunInput,
    DiscoveryRunManifest,
    DiscoveryRunStatus,
)
from rich.console import Console

from atlas_scout.auth import ScoutSession
from atlas_scout.config import ContributionConfig, ScoutConfig, StoreConfig
from atlas_scout.store import ScoutStore

if TYPE_CHECKING:
    from pathlib import Path


def capture_consoles(monkeypatch: object, console_module: object) -> io.StringIO:
    output = io.StringIO()
    monkeypatch.setattr(
        console_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    monkeypatch.setattr(
        console_module,
        "err_console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    return output


def build_config(tmp_path: Path) -> ScoutConfig:
    return ScoutConfig(
        contribution=ContributionConfig(api_key="", atlas_url=""),
        store=StoreConfig(path=str(tmp_path / "scout.db")),
    )


async def seed_run_with_artifacts(config: ScoutConfig) -> str:
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(location="Austin, TX", issues=["housing"], search_depth="standard")
    artifacts = DiscoveryRunArtifacts(
        manifest=DiscoveryRunManifest(
            runner="atlas-scout",
            run=DiscoveryRunInput(location_query="Austin, TX", state="TX", issue_areas=["housing"]),
            status=DiscoveryRunStatus.COMPLETED,
        ),
    )
    await store.save_run_artifacts(run_id, artifacts)
    await store.close()
    return run_id


def workspace_session() -> ScoutSession:
    return ScoutSession(
        atlas_url="https://atlas.example",
        access_token="device-session-token",
        worker_id="worker-123",
        user_id="user-123",
        user_email="user@example.org",
        default_upload_target="workspace",
        workspace_id="org-123",
    )
