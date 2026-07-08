from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import pytest
from rich.console import Console

import atlas_scout.cli as cli_module
from atlas_scout.config import ScoutConfig, StoreConfig
from atlas_scout.store import ScoutStore


def _capture_consoles(monkeypatch: pytest.MonkeyPatch) -> io.StringIO:
    """Redirect both module consoles into a single buffer for assertions."""
    output = io.StringIO()
    monkeypatch.setattr(
        cli_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    monkeypatch.setattr(
        cli_module,
        "err_console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    return output


def _make_config(tmp_path: Path, **overrides: Any) -> ScoutConfig:
    """Return a ScoutConfig pinned to a tmp DB."""
    base: dict[str, Any] = {"store": StoreConfig(path=str(tmp_path / "scout.db"))}
    base.update(overrides)
    return ScoutConfig(**base)


async def _seed_run_with_artifacts(config: ScoutConfig) -> str:
    """Seed a run with a minimal artifact bundle so sync calls don't trip on missing data."""
    from atlas_shared import (
        DiscoveryRunArtifacts,
        DiscoveryRunInput,
        DiscoveryRunManifest,
        DiscoveryRunStatus,
    )

    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Austin, TX", issues=["housing"], search_depth="standard"
    )
    artifacts = DiscoveryRunArtifacts(
        manifest=DiscoveryRunManifest(
            runner="atlas-scout",
            run=DiscoveryRunInput(
                location_query="Austin, TX",
                state="TX",
                issue_areas=["housing"],
            ),
            status=DiscoveryRunStatus.COMPLETED,
        ),
    )
    await store.save_run_artifacts(run_id, artifacts)
    await store.close()
    return run_id
