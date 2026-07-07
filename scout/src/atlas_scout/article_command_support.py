"""Shared helpers for article CLI commands."""

from __future__ import annotations

from datetime import date

import click


def parse_date_option(value: str, *, option_name: str) -> date:
    """Parse a YYYY-MM-DD CLI option."""
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise click.ClickException(f"--{option_name} must use YYYY-MM-DD.") from exc


def date_from_timestamp(value: object) -> date | None:
    """Return a date from an ISO-like timestamp value."""
    if not isinstance(value, str) or not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def article_crawl_seed_urls(
    seed_urls: tuple[str, ...],
    seed_file: click.utils.LazyFile | None,
) -> list[str]:
    """Return normalized crawl seeds from repeated options and an optional file."""
    seeds: list[str] = []
    for seed_url in seed_urls:
        stripped = seed_url.strip()
        if stripped:
            seeds.append(stripped)
    if seed_file is not None:
        for line in seed_file:
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                seeds.append(stripped)
    return seeds
