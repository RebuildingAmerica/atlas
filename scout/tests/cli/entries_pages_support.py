"""Shared helpers for Scout entries and pages CLI tests."""

from __future__ import annotations

import io
from typing import Any

from rich.console import Console

import atlas_scout.cli as cli_module
import atlas_scout.entries.browse as entries_browse_module
import atlas_scout.entries.export as entries_export_module
import atlas_scout.pages_commands as pages_module
from atlas_scout.config import ScheduleConfig, ScheduleTarget, ScoutConfig, StoreConfig
from atlas_scout.store import ScoutStore


def _capture_consoles(monkeypatch) -> io.StringIO:
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
    monkeypatch.setattr(
        entries_browse_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    monkeypatch.setattr(
        entries_export_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    monkeypatch.setattr(
        pages_module,
        "console",
        Console(file=output, force_terminal=False, color_system=None, width=240),
    )
    return output


def _make_config(tmp_path, **overrides: Any) -> ScoutConfig:
    base: dict[str, Any] = {"store": StoreConfig(path=str(tmp_path / "scout.db"))}
    base.update(overrides)
    return ScoutConfig(**base)


def _scheduled_config(tmp_path) -> ScoutConfig:
    return _make_config(
        tmp_path,
        schedule=ScheduleConfig(
            targets=[ScheduleTarget(location="Austin, TX", issues=["housing"])]
        ),
    )


async def _seed_entries(config: ScoutConfig) -> str:
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Austin, TX", issues=["housing"], search_depth="standard"
    )
    await store.save_entry(
        run_id=run_id,
        name="Acme Org",
        entry_type="organization",
        description="An organization",
        city="Austin",
        state="TX",
        score=0.95,
        data={
            "website": "https://acme.example",
            "email": "info@acme.example",
            "issue_areas": ["housing", "legal"],
            "source_urls": ["https://src.example"],
        },
    )
    await store.save_entry(
        run_id=run_id,
        name="Bob Smith",
        entry_type="person",
        description="An individual",
        city=None,
        state=None,
        score=0.5,
        data={
            "issue_areas": ["housing"],
            "source_urls": ["https://src.example/bob"],
            "source_contexts": {"https://src.example/bob": "Bob Smith testified about rent."},
        },
    )
    await store.close()
    return run_id


async def _seed_other_run(config: ScoutConfig) -> str:
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Dallas, TX", issues=["public_transit"], search_depth="standard"
    )
    await store.save_entry(
        run_id=run_id,
        name="Dallas Organizer",
        entry_type="person",
        description="A transit organizer.",
        city="Dallas",
        state="TX",
        score=0.88,
        data={
            "issue_areas": ["public_transit"],
            "source_urls": ["https://src.example/dallas"],
            "source_contexts": {"https://src.example/dallas": "Dallas Organizer organized riders."},
        },
    )
    await store.close()
    return run_id


async def _seed_duplicate_person_run(config: ScoutConfig) -> str:
    store = ScoutStore(config.store.path)
    await store.initialize()
    run_id = await store.create_run(
        location="Austin, TX", issues=["housing"], search_depth="standard"
    )
    await store.save_entry(
        run_id=run_id,
        name="Bob Smith",
        entry_type="person",
        description="A more recent individual profile.",
        city=None,
        state=None,
        score=0.9,
        data={
            "issue_areas": ["housing"],
            "source_urls": ["https://src.example/bob-latest"],
            "source_contexts": {"https://src.example/bob-latest": "Bob Smith chaired the hearing."},
        },
    )
    await store.close()
    return run_id
