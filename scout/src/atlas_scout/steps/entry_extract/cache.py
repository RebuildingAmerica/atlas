"""Caching and validation helpers for entry extraction."""

from __future__ import annotations

import hashlib
import json

from atlas_shared import PageContent, RawEntry

from atlas_scout.steps.validate import validate_entries


def _validate_against_source(entries: list[RawEntry], page: PageContent) -> list[RawEntry]:
    """Drop entries that are not grounded in the source text."""
    return validate_entries(entries, page)


def _prompt_key(system_prompt: str) -> str:
    """Build a stable prompt fingerprint for extraction caching."""
    return hashlib.sha256(system_prompt.encode("utf-8")).hexdigest()


def _page_fingerprint(page: PageContent) -> str:
    """Build a stable page-content fingerprint independent of URL."""
    published = page.published_date.isoformat() if page.published_date else ""
    structured = (
        json.dumps(page.structured_data, sort_keys=True, default=str)
        if page.structured_data
        else ""
    )
    payload = "\n".join(
        [
            page.title or "",
            page.publication or "",
            published,
            str(page.source_type),
            page.text,
            structured,
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _provider_cache_key(provider: object) -> str:
    """Return a stable cache identity for an extraction provider."""
    explicit = getattr(provider, "cache_identity", None)
    if isinstance(explicit, str) and explicit:
        return explicit
    model = getattr(provider, "model", None) or getattr(provider, "_model", None)
    if isinstance(model, str) and model:
        return f"{provider.__class__.__name__.lower()}:{model}"
    return provider.__class__.__name__.lower()


def _extraction_cache_key(
    *,
    source_fingerprint: str,
    provider_key: str,
    prompt_key: str,
) -> str:
    """Combine content, provider, and prompt fingerprints into a cache key."""
    payload = "\n".join([source_fingerprint, provider_key, prompt_key])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _cacheable_entry(entry: RawEntry) -> dict[str, object]:
    """Prepare a raw entry for durable caching without binding it to one source URL."""
    payload = entry.model_dump(mode="json")
    payload["source_url"] = ""
    return payload


def _entries_from_cached(items: list[dict[str, object]], *, source_url: str) -> list[RawEntry]:
    """Rehydrate cached entries and stamp the current source URL onto each one."""
    entries = [RawEntry.model_validate(item) for item in items]
    for entry in entries:
        entry.source_url = source_url
    return entries
