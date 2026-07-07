"""Article import command implementation."""

from __future__ import annotations

import asyncio
import json
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING, Any

import click

from atlas_scout.article_command_support import parse_date_option, run_async
from atlas_scout.article_records import guardian_articles_from_response
from atlas_scout.cli_context import console

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig


_GUARDIAN_SEARCH_URL = "https://content.guardianapis.com/search"
_GUARDIAN_SHOW_FIELDS = "trailText,byline,shortUrl,thumbnail,bodyText"


@click.group("import")
def import_group() -> None:
    """Import article metadata from public news indexes."""


@import_group.command("guardian")
@click.option("--api-key", envvar="GUARDIAN_API_KEY", required=True)
@click.option("--from-date", "from_date_value", required=True, help="Start date YYYY-MM-DD.")
@click.option("--to-date", "to_date_value", required=True, help="End date YYYY-MM-DD.")
@click.option("--target-count", type=click.IntRange(1), required=True)
@click.option("--page-size", type=click.IntRange(1, 200), default=200, show_default=True)
@click.option("--query", default=None, help="Optional Guardian search query.")
@click.option("--section", default=None, help="Optional Guardian section filter.")
@click.option("--delay-ms", type=click.IntRange(0), default=100, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Print machine-readable JSON.")
@click.pass_context
def guardian(
    ctx: click.Context,
    api_key: str,
    from_date_value: str,
    to_date_value: str,
    target_count: int,
    page_size: int,
    query: str | None,
    section: str | None,
    delay_ms: int,
    json_output: bool,
) -> None:
    """Import Guardian Content API article metadata into the local Scout DB."""
    config: ScoutConfig = ctx.obj["config"]
    from_date = parse_date_option(from_date_value, option_name="from-date")
    to_date = parse_date_option(to_date_value, option_name="to-date")
    run_async(
        import_guardian_articles(
            config,
            api_key=api_key,
            from_date=from_date,
            to_date=to_date,
            target_count=target_count,
            page_size=page_size,
            query=query,
            section=section,
            delay_ms=delay_ms,
            json_output=json_output,
        )
    )


async def import_guardian_articles(
    config: ScoutConfig,
    *,
    api_key: str,
    from_date: date,
    to_date: date,
    target_count: int,
    page_size: int,
    query: str | None,
    section: str | None,
    delay_ms: int,
    json_output: bool,
) -> None:
    """Import Guardian article metadata across yearly date windows."""
    if from_date > to_date:
        raise click.ClickException("--from-date must be on or before --to-date.")

    import httpx

    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    total_fetched = 0
    total_saved = 0
    total_skipped = 0
    total_updated = 0
    by_year: dict[str, int] = {}
    windows = year_windows(from_date, to_date)
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            for index, (window_start, window_end) in enumerate(windows):
                if total_saved >= target_count:
                    break
                remaining_windows = len(windows) - index
                remaining_target = target_count - total_saved
                window_target = max(
                    1, (remaining_target + remaining_windows - 1) // remaining_windows
                )
                page = 1
                saved_in_window = 0
                pages = 1
                while (
                    total_saved < target_count and saved_in_window < window_target and page <= pages
                ):
                    payload = await fetch_guardian_page(
                        client,
                        api_key=api_key,
                        from_date=window_start,
                        to_date=window_end,
                        page=page,
                        page_size=page_size,
                        query=query,
                        section=section,
                    )
                    response = payload.get("response")
                    if not isinstance(response, dict) or response.get("status") != "ok":
                        raise click.ClickException("Guardian API returned an invalid response.")
                    pages = int(response.get("pages") or 0)
                    articles = guardian_articles_from_response(response)
                    total_fetched += len(articles)
                    saved = await store.bulk_save_articles(articles, update_existing=True)
                    total_saved += saved["saved"]
                    total_skipped += saved["skipped"]
                    total_updated += saved["updated"]
                    saved_in_window += saved["saved"]
                    for article in articles:
                        published_at = str(article["published_at"])
                        year = published_at[:4]
                        by_year[year] = by_year.get(year, 0) + 1
                    page += 1
                    if delay_ms > 0 and total_saved < target_count and page <= pages:
                        await asyncio.sleep(delay_ms / 1000)
    finally:
        await store.close()

    payload = {
        "provider": "guardian",
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "target_count": target_count,
        "fetched": total_fetched,
        "saved": total_saved,
        "skipped": total_skipped,
        "updated": total_updated,
        "by_year": by_year,
    }
    if json_output:
        click.echo(json.dumps(payload, sort_keys=True))
        return
    console.print(
        f"Imported {total_saved} Guardian articles "
        f"({total_fetched} fetched, {total_updated} updated, {total_skipped} skipped)."
    )


async def fetch_guardian_page(
    client: Any,
    *,
    api_key: str,
    from_date: date,
    to_date: date,
    page: int,
    page_size: int,
    query: str | None,
    section: str | None,
) -> dict[str, Any]:
    """Fetch one Guardian Content API page."""
    params: dict[str, str | int] = {
        "api-key": api_key,
        "from-date": from_date.isoformat(),
        "to-date": to_date.isoformat(),
        "page": page,
        "page-size": page_size,
        "order-by": "oldest",
        "show-fields": _GUARDIAN_SHOW_FIELDS,
        "show-tags": "all",
    }
    if query:
        params["q"] = query
    if section:
        params["section"] = section
    response = await client.get(_GUARDIAN_SEARCH_URL, params=params)
    response.raise_for_status()
    payload = response.json()
    return payload if isinstance(payload, dict) else {}


def year_windows(from_date: date, to_date: date) -> list[tuple[date, date]]:
    """Return inclusive yearly date windows for balanced archive import."""
    windows: list[tuple[date, date]] = []
    year = from_date.year
    while year <= to_date.year:
        start = max(from_date, date(year, 1, 1))
        end = min(to_date, date(year, 12, 31))
        windows.append((start, end))
        year += 1
    return windows
