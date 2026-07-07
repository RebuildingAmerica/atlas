"""Local SQLite store for Atlas Scout runs, cache, entries, and daemon state."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import aiosqlite

_SQLITE_BUSY_TIMEOUT_MS = 60000

_CREATE_RUNS = """
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    location TEXT NOT NULL,
    issues TEXT NOT NULL,
    search_depth TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT,
    completed_at TEXT,
    queries INTEGER,
    pages_fetched INTEGER,
    entries_found INTEGER,
    entries_after_dedup INTEGER,
    error TEXT,
    created_at TEXT NOT NULL
)
"""

_CREATE_PAGES = """
CREATE TABLE IF NOT EXISTS pages (
    url TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    content_hash TEXT,
    fetched_at TEXT NOT NULL
)
"""

_CREATE_PAGE_TASKS = """
CREATE TABLE IF NOT EXISTS page_tasks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    error TEXT,
    entries_extracted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""

_CREATE_ENTRIES = """
CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    name TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    description TEXT NOT NULL,
    city TEXT,
    state TEXT,
    score REAL NOT NULL DEFAULT 0.0,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
)
"""

_CREATE_ARTICLES = """
CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    published_at TEXT NOT NULL,
    source_name TEXT,
    source_domain TEXT NOT NULL,
    section TEXT,
    provider TEXT NOT NULL,
    provider_id TEXT,
    api_url TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
)
"""

_CREATE_ARTICLES_PUBLISHED_INDEX = """
CREATE INDEX IF NOT EXISTS idx_articles_published_at
ON articles(published_at)
"""

_CREATE_ARTICLES_SOURCE_INDEX = """
CREATE INDEX IF NOT EXISTS idx_articles_source_domain
ON articles(source_domain)
"""

_CREATE_ARTICLE_FRONTIER = """
CREATE TABLE IF NOT EXISTS article_frontier (
    url TEXT PRIMARY KEY,
    seed_url TEXT NOT NULL,
    depth INTEGER NOT NULL DEFAULT 0 CHECK(depth >= 0),
    priority INTEGER NOT NULL DEFAULT 0,
    source_domain TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'fetched', 'skipped')),
    discovered_at TEXT NOT NULL,
    fetched_at TEXT,
    claimed_by TEXT,
    claimed_at TEXT,
    claim_expires_at TEXT,
    updated_at TEXT NOT NULL
)
"""

_CREATE_ARTICLE_FRONTIER_STATUS_INDEX = """
CREATE INDEX IF NOT EXISTS idx_article_frontier_status_priority
ON article_frontier(status, priority DESC, discovered_at ASC)
"""

_CREATE_ARTICLE_FRONTIER_DOMAIN_INDEX = """
CREATE INDEX IF NOT EXISTS idx_article_frontier_source_domain
ON article_frontier(source_domain, status)
"""

_CREATE_ARTICLE_FRONTIER_CLAIM_INDEX = """
CREATE INDEX IF NOT EXISTS idx_article_frontier_claims
ON article_frontier(status, claim_expires_at, priority DESC, discovered_at ASC)
"""

_CREATE_EXTRACTIONS = """
CREATE TABLE IF NOT EXISTS extractions (
    cache_key TEXT PRIMARY KEY,
    source_fingerprint TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    prompt_key TEXT NOT NULL,
    entries TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
)
"""

_CREATE_RUN_ARTIFACTS = """
CREATE TABLE IF NOT EXISTS run_artifacts (
    run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    artifact_hash TEXT NOT NULL,
    artifacts_json TEXT NOT NULL,
    sync_status TEXT,
    remote_run_id TEXT,
    synced_at TEXT,
    last_error TEXT,
    updated_at TEXT NOT NULL
)
"""

_CREATE_WORK_CLAIMS = """
CREATE TABLE IF NOT EXISTS work_claims (
    key TEXT PRIMARY KEY,
    owner_run_id TEXT NOT NULL,
    status TEXT NOT NULL,
    lease_expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    error TEXT
)
"""

_CREATE_DAEMON_STATE = """
CREATE TABLE IF NOT EXISTS daemon_state (
    key TEXT PRIMARY KEY CHECK(key = 'scout'),
    status TEXT NOT NULL DEFAULT 'stopped' CHECK(status IN ('starting', 'running', 'stopped')),
    started_at TEXT,
    last_heartbeat_at TEXT,
    config_path TEXT,
    profile_name TEXT,
    process_id INTEGER,
    target_count INTEGER NOT NULL DEFAULT 0 CHECK(target_count >= 0),
    interval_seconds INTEGER,
    interval_basis TEXT,
    last_tick_summary TEXT,
    updated_at TEXT NOT NULL
)
"""

_CREATE_PAGE_TASKS_RUN_URL_INDEX = """
CREATE INDEX IF NOT EXISTS idx_page_tasks_run_url
ON page_tasks(run_id, url)
"""

_CREATE_PAGE_TASKS_RUN_STATUS_INDEX = """
CREATE INDEX IF NOT EXISTS idx_page_tasks_run_status
ON page_tasks(run_id, status)
"""

_DAEMON_STATE_KEY = "scout"


def _now() -> str:
    """Return the current UTC time as an ISO 8601 string."""
    return datetime.now(UTC).isoformat()


def _new_id() -> str:
    """Generate a short random hex ID (12 characters)."""
    return uuid.uuid4().hex[:12]


def _optional_row_int(row: aiosqlite.Row | None, key: str) -> int:
    """Return an integer aggregate value from an optional SQLite row."""
    if row is None:
        return 0
    value = row[key]
    return int(value) if value is not None else 0


def _serialize_timestamp(value: datetime | None) -> str | None:
    """Normalize an optional timezone-aware timestamp to UTC ISO 8601."""
    if value is None:
        return None
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("timestamps must be timezone-aware")
    return value.astimezone(UTC).isoformat()


def _validate_target_count(target_count: int) -> int:
    """Validate the daemon target count before persisting it."""
    if target_count < 0:
        raise ValueError("target_count must be non-negative")
    return target_count


def _validate_process_id(process_id: int | None) -> int | None:
    """Validate an optional daemon process identifier."""
    if process_id is not None and process_id <= 0:
        raise ValueError("process_id must be positive")
    return process_id


def _validate_interval_seconds(interval_seconds: int | None) -> int | None:
    """Validate an optional daemon interval in seconds."""
    if interval_seconds is not None and interval_seconds < 0:
        raise ValueError("interval_seconds must be non-negative")
    return interval_seconds


def _has_source_context(data: dict[str, Any]) -> bool:
    """Return whether an entry has source-local context beyond a bare URL."""
    source_context = data.get("source_context")
    if isinstance(source_context, str) and source_context.strip():
        return True

    extraction_context = data.get("extraction_context")
    if isinstance(extraction_context, str) and extraction_context.strip():
        return True

    source_contexts = data.get("source_contexts")
    if isinstance(source_contexts, dict):
        return any(isinstance(value, str) and value.strip() for value in source_contexts.values())

    return False


def _entry_exact_key(
    *,
    name: str,
    city: str | None,
    state: str | None,
    entry_type: str,
) -> tuple[str, str, str, str]:
    """Return the conservative exact key used for entry uniqueness stats."""
    return (
        name.strip().lower(),
        city.strip().upper() if city else "",
        state.strip().upper() if state else "",
        entry_type.strip().lower(),
    )


def _article_record(row: aiosqlite.Row) -> dict[str, Any]:
    """Return a JSON-ready article record from a SQLite row."""
    record = dict(row)
    record["metadata"] = json.loads(record["metadata"])
    return record


def _article_update_row(article: dict[str, Any], url: str) -> tuple[Any, ...]:
    """Return an UPDATE row for an existing article URL."""
    return (
        str(article["title"]),
        str(article["published_at"]),
        article.get("source_name"),
        str(article["source_domain"]),
        article.get("section"),
        str(article["provider"]),
        article.get("provider_id"),
        article.get("api_url"),
        json.dumps(article.get("metadata", {})),
        url,
    )


def _article_has_complete_metadata(row: aiosqlite.Row, metadata: dict[str, Any]) -> bool:
    """Return whether an article has enough metadata to review later."""
    required_row_values = (
        row["url"],
        row["title"],
        row["published_at"],
        row["source_domain"],
        row["provider"],
        row["provider_id"],
    )
    has_core_row = all(isinstance(value, str) and value.strip() for value in required_row_values)
    if not has_core_row:
        return False
    has_text_context = bool(
        metadata.get("trail_text")
        or metadata.get("body_text_excerpt")
        or metadata.get("body_text_length")
    )
    has_provider_context = _article_has_provider_context(metadata)
    return has_text_context and has_provider_context


def _article_has_provider_context(metadata: dict[str, Any]) -> bool:
    """Return whether provider metadata identifies how the article was sourced."""
    has_guardian_context = bool(
        metadata.get("guardian_tags")
        or metadata.get("byline")
        or metadata.get("short_url")
        or metadata.get("thumbnail")
        or metadata.get("section_id")
        or metadata.get("pillar_name")
    )
    if has_guardian_context:
        return True
    if metadata.get("discovery_method") != "crawl" or not metadata.get("seed_url"):
        return False
    return bool(
        metadata.get("publication")
        or metadata.get("schema_types")
        or metadata.get("opengraph_type")
        or metadata.get("source_type")
    )

