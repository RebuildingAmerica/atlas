"""Article export command implementation."""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

import click

from atlas_scout.cli_common import _run_async
from atlas_scout.cli_context import console

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig


_ARTICLE_EXPORT_CSV_FIELDS = [
    "url",
    "title",
    "published_at",
    "source_name",
    "source_domain",
    "section",
    "provider",
    "provider_id",
    "api_url",
    "metadata",
    "created_at",
]


@click.command("export")
@click.option(
    "--format",
    "-o",
    "output_format",
    type=click.Choice(["jsonl", "json", "csv"]),
    default="jsonl",
    show_default=True,
)
@click.option("--limit", type=click.IntRange(0), default=0, show_default=True)
@click.option("--provider", default=None)
@click.option("--source-domain", default=None)
@click.option(
    "--output",
    type=click.Path(dir_okay=False, path_type=Path),
    default=None,
    help="Write to a file instead of stdout.",
)
@click.pass_context
def export(
    ctx: click.Context,
    output_format: str,
    limit: int,
    provider: str | None,
    source_domain: str | None,
    output: Path | None,
) -> None:
    """Export stored article records."""
    config: ScoutConfig = ctx.obj["config"]
    _run_async(
        export_articles(
            config,
            output_format=output_format,
            limit=limit,
            provider=provider,
            source_domain=source_domain,
            output=output,
        )
    )


async def export_articles(
    config: ScoutConfig,
    *,
    output_format: str,
    limit: int,
    provider: str | None,
    source_domain: str | None,
    output: Path | None,
) -> None:
    """Export stored article records to stdout or a file."""
    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        rows = await store.list_articles(
            limit=limit,
            provider=provider,
            source_domain=source_domain,
        )
    finally:
        await store.close()

    if output is None:
        write_article_export(rows, output_format, sys.stdout)
        return

    output_path = output.expanduser()
    if not output_path.parent.exists():
        raise click.ClickException(f"Output directory does not exist: {output_path.parent}")
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        write_article_export(rows, output_format, handle)
    console.print(f"Exported {len(rows)} articles to {output_path}")


def write_article_export(rows: list[dict[str, Any]], output_format: str, handle: Any) -> None:
    """Write article rows to a text handle."""
    if output_format == "json":
        json.dump(rows, handle, indent=2)
        handle.write("\n")
        return
    if output_format == "jsonl":
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True))
            handle.write("\n")
        return

    writer = csv.DictWriter(handle, fieldnames=_ARTICLE_EXPORT_CSV_FIELDS)
    writer.writeheader()
    for row in rows:
        writer.writerow(article_export_csv_row(row))


def article_export_csv_row(row: dict[str, Any]) -> dict[str, str]:
    """Flatten an article row for CSV export."""
    return {
        "url": str(row.get("url") or ""),
        "title": str(row.get("title") or ""),
        "published_at": str(row.get("published_at") or ""),
        "source_name": str(row.get("source_name") or ""),
        "source_domain": str(row.get("source_domain") or ""),
        "section": str(row.get("section") or ""),
        "provider": str(row.get("provider") or ""),
        "provider_id": str(row.get("provider_id") or ""),
        "api_url": str(row.get("api_url") or ""),
        "metadata": json.dumps(row.get("metadata") or {}, sort_keys=True),
        "created_at": str(row.get("created_at") or ""),
    }
