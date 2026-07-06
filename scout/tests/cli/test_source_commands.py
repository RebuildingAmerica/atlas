"""CLI tests for source-neutral entry operations."""

from __future__ import annotations

import asyncio
import json
import textwrap
from typing import TYPE_CHECKING

from click.testing import CliRunner

from atlas_scout.cli import main
from atlas_scout.store import ScoutStore

if TYPE_CHECKING:
    from pathlib import Path


def _write_config(tmp_path: Path) -> Path:
    config_path = tmp_path / "scout.toml"
    db_path = tmp_path / "scout.db"
    config_path.write_text(
        textwrap.dedent(
            f"""\
            [store]
            path = "{db_path}"
            """
        )
    )
    return config_path


async def _seed_entries(config_path: Path) -> str:
    db_path = config_path.parent / "scout.db"
    store = ScoutStore(str(db_path))
    await store.initialize()
    run_id = await store.create_run(
        location="Las Vegas, NV",
        issues=["transportation_and_mobility"],
        search_depth="standard",
    )
    await store.save_entry(
        run_id=run_id,
        name="Discovery Person",
        entry_type="person",
        description="A transit organizer quoted in a local source.",
        city="Las Vegas",
        state="NV",
        score=0.91,
        data={
            "source_urls": ["https://example.org/transit"],
            "source_contexts": {"https://example.org/transit": "Discovery Person said ..."},
            "issue_areas": ["transportation_and_mobility"],
        },
    )
    await store.save_entry(
        run_id=run_id,
        name="Structured IRS Person",
        entry_type="person",
        description="Officer from structured bulk data.",
        city="Las Vegas",
        state="NV",
        score=0.82,
        data={
            "source_dataset": "irs_990_people",
            "source_key": "irs-990:test",
            "source_urls": ["file://irs.zip#sample.xml"],
            "source_context": "Structured IRS Person served as Director.",
        },
    )
    await store.close()
    return run_id


def test_source_command_is_not_public_cli_surface() -> None:
    """The CLI should not expose source-specific bulk import commands."""
    help_result = CliRunner().invoke(main, ["--help"])
    source_result = CliRunner().invoke(main, ["source", "import", "--help"])

    assert help_result.exit_code == 0
    assert " source " not in help_result.output
    assert source_result.exit_code != 0
    assert "No such command 'source'" in source_result.output


def test_entries_stats_excludes_source_datasets_and_enforces_people_count(
    tmp_path: Path,
) -> None:
    """Stats should be able to ignore structured datasets for discovery proof gates."""
    config_path = _write_config(tmp_path)
    run_id = asyncio.run(_seed_entries(config_path))

    result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "entries",
            "stats",
            "--json",
            "--run-id",
            run_id,
            "--exclude-source-dataset",
            "irs_990_people",
            "--min-people",
            "1",
            "--min-source-backed",
            "1",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["total_entries"] == 1
    assert payload["by_type"] == {"person": 1}
    assert payload["source_backed_entries"] == 1
    assert payload["contextual_person_count"] == 1
    assert payload["source_url_count"] == 1
    assert payload["source_domain_count"] == 1
    assert payload["by_location"] == {"Las Vegas, NV": 1}
    assert payload["by_source_dataset"] == {}


def test_entries_stats_enforces_unique_people_count(tmp_path: Path) -> None:
    """Stats gates should be able to count exact unique people, not only row artifacts."""
    config_path = _write_config(tmp_path)
    db_path = config_path.parent / "scout.db"
    store = ScoutStore(str(db_path))
    asyncio.run(store.initialize())
    first_run_id = asyncio.run(
        store.create_run(location="United States", issues=[], search_depth="standard")
    )
    second_run_id = asyncio.run(
        store.create_run(location="United States", issues=[], search_depth="standard")
    )
    for run_id, source_url in (
        (first_run_id, "https://example.gov/a.csv"),
        (second_run_id, "https://example.gov/b.csv"),
    ):
        asyncio.run(
            store.save_entry(
                run_id=run_id,
                name="Jane Doe",
                entry_type="person",
                description="Source-backed person",
                city="Dallas",
                state="TX",
                score=0.8,
                data={
                    "source_urls": [source_url],
                    "source_contexts": {source_url: "name=DOE, JANE"},
                },
            )
        )
    asyncio.run(store.close())

    passing_result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "entries",
            "stats",
            "--json",
            "--min-people",
            "2",
            "--min-unique-people",
            "1",
        ],
    )
    failing_result = CliRunner().invoke(
        main,
        [
            "--config",
            str(config_path),
            "entries",
            "stats",
            "--min-unique-people",
            "2",
        ],
    )

    assert passing_result.exit_code == 0
    payload = json.loads(passing_result.output)
    assert payload["by_type"] == {"person": 2}
    assert payload["unique_person_keys"] == 1
    assert payload["exact_duplicate_surplus"] == 1
    assert failing_result.exit_code != 0
    assert "Only 1 exact unique people; expected at least 2." in failing_result.output


def test_entries_purge_deletes_source_dataset_from_active_entries(tmp_path: Path) -> None:
    """Purge should remove structured source rows from active discovery stats."""
    config_path = _write_config(tmp_path)
    asyncio.run(_seed_entries(config_path))
    runner = CliRunner()

    purge_result = runner.invoke(
        main,
        [
            "--config",
            str(config_path),
            "entries",
            "purge",
            "--source-dataset",
            "irs_990_people",
            "--yes",
            "--json",
        ],
    )
    stats_result = runner.invoke(
        main,
        [
            "--config",
            str(config_path),
            "entries",
            "stats",
            "--json",
        ],
    )

    assert purge_result.exit_code == 0
    purge_payload = json.loads(purge_result.output)
    assert purge_payload["matched"] == 1
    assert purge_payload["deleted"] == 1
    assert purge_payload["source_dataset"] == "irs_990_people"
    assert stats_result.exit_code == 0
    stats = json.loads(stats_result.output)
    assert stats["total_entries"] == 1
    assert stats["by_type"] == {"person": 1}
    assert stats["source_backed_entries"] == 1
    assert stats["by_source_dataset"] == {}


def test_config_set_writes_explicit_config_path(tmp_path: Path, monkeypatch) -> None:
    """`--config X config set` should update X instead of the active profile."""
    import atlas_scout.cli as cli_module

    selected_config = tmp_path / "selected.toml"
    active_config = tmp_path / "active.toml"
    monkeypatch.setattr(cli_module, "get_active_config_path", lambda: active_config)

    result = CliRunner().invoke(
        main,
        ["--config", str(selected_config), "config", "set", "store.path", "/tmp/launch.db"],
    )

    assert result.exit_code == 0
    assert 'path = "/tmp/launch.db"' in selected_config.read_text()
    assert not active_config.exists()
