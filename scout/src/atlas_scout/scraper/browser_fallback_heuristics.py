"""Heuristics deciding when a failed fetch deserves bounded browser rendering."""

from __future__ import annotations

import re
from urllib.parse import urlparse

BROWSER_FALLBACK_REASONS = frozenset(
    {"content_not_extractable", "content_below_min_words", "empty_body", "sparse_civic_roster"}
)
BROWSER_FALLBACK_STATUS_CODES = frozenset({"http_401", "http_403"})
APP_SHELL_MARKERS = (
    'id="__next"',
    "id='__next'",
    'id="root"',
    "id='root'",
    "data-reactroot",
    "__NUXT__",
    "__NEXT_DATA__",
    "webpackJsonp",
    "window.__",
    "ng-version",
)
NEWS_DOMAIN_MARKERS = (
    "news",
    "times",
    "post",
    "tribune",
    "journal",
    "gazette",
    "herald",
    "observer",
    "daily",
    "weekly",
)


def looks_like_high_value_url(url: str) -> bool:
    """Return whether a URL is worth bounded browser rendering."""
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    path = parsed.path.lower()
    if any(marker in domain for marker in NEWS_DOMAIN_MARKERS):
        return True
    return any(
        segment in path
        for segment in (
            "/news/",
            "/article/",
            "/articles/",
            "/story/",
            "/stories/",
            "/local/",
            "/politics/",
            "/government/",
        )
    )


def looks_like_app_shell(html: str) -> bool:
    """Return whether HTML looks like a JavaScript-rendered app shell."""
    lower_html = html.lower()
    if any(marker.lower() in lower_html for marker in APP_SHELL_MARKERS):
        return True
    script_count = lower_html.count("<script")
    visible_word_count = len(lower_html.replace("<", " ").replace(">", " ").split())
    return script_count >= 3 and visible_word_count < 120


def looks_like_sparse_civic_roster(text: str) -> bool:
    """Return whether extracted text kept offices but likely lost rendered names."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    office_lines = [
        line
        for line in lines
        if re.search(r"\b(mayor|council(?:man|woman)?|trustee|commissioner)\b", line, re.I)
    ]
    if len(office_lines) < 2:
        return False
    person_like_lines = [
        line
        for line in lines
        if re.fullmatch(r"[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4}", line)
    ]
    return len(person_like_lines) < 2
