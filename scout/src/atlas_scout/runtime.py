"""Adaptive runtime sizing for Scout worker pools and queues."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig

_DEFAULT_MEMORY_BYTES = 8 * 1024 * 1024 * 1024


@dataclass(slots=True)
class RuntimeProfile:
    """Effective runtime sizing derived from config and machine capacity."""

    cpu_count: int
    total_memory_bytes: int
    max_memory_percent: int
    max_total_workers: int
    search_concurrency: int
    fetch_concurrency: int
    extract_concurrency: int
    url_frontier_queue_size: int
    fetched_page_queue_size: int


def build_runtime_profile(config: ScoutConfig, *, direct_mode: bool = False) -> RuntimeProfile:
    """Build an effective runtime profile from config and detected hardware."""
    cpu_count = max(1, os.cpu_count() or 1)
    total_memory_bytes = _detect_total_memory_bytes()
    runtime = config.runtime

    max_total_workers = runtime.max_total_workers or max(16, cpu_count * 8)
    local_provider = config.llm.provider == "ollama"

    if local_provider:
        configured_cap = (
            config.llm.max_concurrent
            if config.llm.max_concurrent > 0
            else max(1, min(cpu_count, 4))
        )
        extract_concurrency = 1 if direct_mode else max(1, min(configured_cap, 2))
    elif config.llm.max_concurrent > 0:
        extract_concurrency = config.llm.max_concurrent
    else:
        extract_concurrency = max(4, min(32, cpu_count * 2))

    if config.scraper.max_concurrent_fetches > 0:
        fetch_concurrency = config.scraper.max_concurrent_fetches
    else:
        factor = 3 if local_provider else 4
        fetch_concurrency = max(8, min(128, cpu_count * factor))

    if config.scraper.max_concurrent_searches > 0:
        search_concurrency = config.scraper.max_concurrent_searches
    else:
        search_concurrency = max(1, min(32, max_total_workers // 4))
    url_frontier_queue_size = max(500, fetch_concurrency * 50)
    fetched_page_queue_size = max(100, fetch_concurrency * 10)

    return RuntimeProfile(
        cpu_count=cpu_count,
        total_memory_bytes=total_memory_bytes,
        max_memory_percent=runtime.max_memory_percent,
        max_total_workers=max_total_workers,
        search_concurrency=search_concurrency,
        fetch_concurrency=fetch_concurrency,
        extract_concurrency=extract_concurrency,
        url_frontier_queue_size=url_frontier_queue_size,
        fetched_page_queue_size=fetched_page_queue_size,
    )


def _detect_total_memory_bytes() -> int:
    """Best-effort total RAM detection with a safe fallback."""
    try:
        if hasattr(os, "sysconf") and "SC_PAGE_SIZE" in os.sysconf_names:
            page_size = int(os.sysconf("SC_PAGE_SIZE"))
            phys_pages = int(os.sysconf("SC_PHYS_PAGES"))
            if page_size > 0 and phys_pages > 0:
                return page_size * phys_pages
    except (OSError, ValueError):
        pass
    return _DEFAULT_MEMORY_BYTES
