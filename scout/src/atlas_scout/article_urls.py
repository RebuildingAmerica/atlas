"""Article URL canonicalization helpers."""

from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlparse

from atlas_scout.pipeline_support import normalize_url

__all__ = ["canonicalize_article_url"]

_TRACKING_QUERY_KEYS = {
    "article",
    "category",
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "mibextid",
    "mod",
    "ref",
    "ref_src",
    "subcategory",
}


def canonicalize_article_url(url: str) -> str:
    """Return a stable article URL by removing common tracking query parameters."""
    normalized = normalize_url(url)
    if not normalized:
        return ""
    parsed = urlparse(normalized)
    if parsed.scheme == "http":
        parsed = parsed._replace(scheme="https")
    if parsed.path not in {"", "/"} and parsed.path.endswith("/"):
        parsed = parsed._replace(path=parsed.path.rstrip("/"))
    if not parsed.query:
        return normalize_url(parsed.geturl())
    kept_query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if not _is_tracking_query_key(key)
    ]
    return normalize_url(parsed._replace(query=urlencode(kept_query, doseq=True)).geturl())


def _is_tracking_query_key(key: str) -> bool:
    """Return whether a query key is a known non-canonical tracking parameter."""
    normalized_key = key.strip().lower()
    return normalized_key.startswith(("utm_", "gaa_")) or normalized_key in _TRACKING_QUERY_KEYS
