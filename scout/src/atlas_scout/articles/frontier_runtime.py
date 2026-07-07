"""Runtime helpers for article frontier commands."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

import click
from rich.table import Table

from atlas_scout.articles.frontier import (
    article_frontier_item,
    article_frontier_priority,
    source_seed_frontier_priority,
)
from atlas_scout.cli_context import console
from atlas_scout.pipeline_support import normalize_url

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig


async def show_frontier_stats(config: ScoutConfig, *, json_output: bool) -> None:
    """Load and print persisted article frontier stats."""
    frontier_stats = await load_article_frontier_stats(config)
    if json_output:
        click.echo(json.dumps(frontier_stats, sort_keys=True))
        return
    render_frontier_stats_table(frontier_stats)


def render_frontier_stats_table(frontier_stats: dict[str, Any]) -> None:
    """Print article frontier stats as a compact terminal table."""
    table = Table(title="Article frontier", show_lines=False, pad_edge=False)
    table.add_column("Metric", style="bold")
    table.add_column("Value")
    table.add_row("Pending", str(frontier_stats["pending"]))
    table.add_row("Claimed", str(frontier_stats["claimed"]))
    table.add_row("Fetched", str(frontier_stats["fetched"]))
    table.add_row("Skipped", str(frontier_stats["skipped"]))
    table.add_row(
        "Pending by source domain",
        json.dumps(frontier_stats["by_source_domain"], sort_keys=True),
    )
    console.print(table)


async def release_frontier_claims(
    config: ScoutConfig,
    *,
    worker_id: str,
    json_output: bool,
) -> None:
    """Release unfinished frontier leases owned by one worker."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        released = await store.release_article_frontier_claims_by_worker(worker_id=worker_id)
        frontier_stats = await store.article_frontier_stats()
    finally:
        await store.close()

    payload = {"worker_id": worker_id, "released": released, **frontier_stats}
    if json_output:
        click.echo(json.dumps(payload, sort_keys=True))
        return
    console.print(f"Released {released} article frontier claims for {worker_id}.")


async def reprioritize_frontier(
    config: ScoutConfig,
    *,
    limit: int,
    json_output: bool,
) -> None:
    """Repair pending frontier priority values using Scout's article URL heuristic."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        rows = await store.list_article_frontier_pending(limit=limit)
        priorities = {str(row["url"]): article_frontier_priority(str(row["url"])) for row in rows}
        updated = await store.update_article_frontier_priorities(priorities)
        frontier_stats = await store.article_frontier_stats()
    finally:
        await store.close()

    payload = {"scanned": len(rows), "updated": updated, **frontier_stats}
    if json_output:
        click.echo(json.dumps(payload, sort_keys=True))
        return
    console.print(
        f"Reprioritized {updated} pending frontier URLs ({payload['pending']} still pending)."
    )


async def seed_frontier(
    config: ScoutConfig,
    *,
    seed_urls: list[str],
    json_output: bool,
) -> None:
    """Persist source seeds as pending frontier URLs through Scout's store."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        result = await store.upsert_article_frontier(
            [
                article_frontier_item(
                    url=normalize_url(seed_url),
                    seed_url=normalize_url(seed_url),
                    depth=0,
                    priority=source_seed_frontier_priority(normalize_url(seed_url)),
                )
                for seed_url in seed_urls
            ]
        )
        frontier_stats = await store.article_frontier_stats()
    finally:
        await store.close()

    payload = {**result, **frontier_stats}
    if json_output:
        click.echo(json.dumps(payload, sort_keys=True))
        return
    console.print(
        f"Persisted {result['saved']} source seeds "
        f"({frontier_stats['pending']} pending frontier URLs)."
    )


async def load_article_frontier_stats(config: ScoutConfig) -> dict[str, Any]:
    """Return persisted article frontier stats from the configured store."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize(create_schema=False)
    try:
        return await store.article_frontier_stats()
    finally:
        await store.close()
