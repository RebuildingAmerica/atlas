"""Focused helper logic for Scout pipeline scheduling and URL handling."""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from urllib.parse import urldefrag, urlparse

from atlas_shared import PageContent

_CODE_FENCE_RE = re.compile(r"^```(?:json)?\s*\n(.*?)```\s*$", re.DOTALL)


@dataclass(frozen=True, slots=True)
class ExtractionAdmission:
    """Decision for whether a fetched page should consume an extraction slot."""

    priority: int | None
    skip_reason: str | None = None

    @property
    def should_extract(self) -> bool:
        return self.priority is not None


def decide_extraction_admission(
    *,
    page: PageContent,
    depth: int,
) -> ExtractionAdmission:
    """Return extraction priority for a page based on depth.

    Every page with content gets extracted. The model decides what's
    worth keeping — not URL heuristics. Depth controls priority so
    seed pages are processed first.
    """
    return ExtractionAdmission(priority=depth * 10)


def extract_worker_count(provider: object, *, direct_mode: bool) -> int:
    """Return the extraction worker count from the provider's configured concurrency."""
    return max(1, int(getattr(provider, "max_concurrent", 1) or 1))


def is_ollama_provider(provider: object) -> bool:
    """Return True when the provider is Ollama-backed."""
    cache_identity = getattr(provider, "cache_identity", "")
    if isinstance(cache_identity, str) and cache_identity.startswith("ollama:"):
        return True
    return provider.__class__.__name__.lower().startswith("ollama")


def merge_discovered_links(raw_links: object, page: object) -> list[str]:
    """Merge discovered-link metadata from the fetch outcome and page payload."""
    merged: list[str] = []
    seen: set[str] = set()

    def _append(values: object) -> None:
        if not isinstance(values, list):
            return
        for value in values:
            normalized = normalize_url(str(value))
            if normalized and normalized not in seen:
                seen.add(normalized)
                merged.append(normalized)

    _append(raw_links)
    if isinstance(page, PageContent):
        _append(page.discovered_links)
    return merged


def normalize_url(url: str) -> str:
    """Normalize URLs for frontier dedupe."""
    stripped = url.strip()
    if not stripped:
        return ""
    normalized, _fragment = urldefrag(stripped)
    if normalized.endswith("/"):
        normalized = normalized.rstrip("/")
    return normalized


def same_domain(base_url: str, candidate_url: str) -> bool:
    """Return True when two URLs share the same HTTP(S) host."""
    base = urlparse(base_url)
    candidate = urlparse(candidate_url)
    if candidate.scheme not in {"http", "https"}:
        return False
    return base.netloc == candidate.netloc


def parse_location(location: str) -> tuple[str, str]:
    """Split ``City, ST`` into ``(city, state)``."""
    parts = location.split(",", maxsplit=1)
    city = parts[0].strip()
    state = parts[1].strip() if len(parts) > 1 else ""
    return city, state


def error_reason(exc: Exception) -> str:
    """Return a non-empty reason string for pipeline error reporting."""
    message = str(exc).strip()
    return message or exc.__class__.__name__


def strip_code_fence(value: str) -> str:
    """Remove optional Markdown code fences around a JSON response."""
    match = _CODE_FENCE_RE.match(value.strip())
    return match.group(1).strip() if match else value.strip()


async def close_if_supported(obj: object) -> None:
    """Close an object if it exposes an async close method."""
    close = getattr(obj, "aclose", None) or getattr(obj, "close", None)
    if callable(close):
        maybe_coro = close()
        if asyncio.iscoroutine(maybe_coro):
            await maybe_coro
