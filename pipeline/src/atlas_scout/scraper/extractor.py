"""HTML to clean text extraction via trafilatura."""

from __future__ import annotations

import re

import trafilatura

from atlas_shared import PageContent, SourceType

MIN_WORD_COUNT = 200
LOGIN_PATTERNS = re.compile(
    r"(please (log|sign) in|create an account|subscribe to continue|paywall)",
    re.IGNORECASE,
)


def extract_content(html: str, url: str) -> PageContent | None:
    """Extract clean text and metadata from HTML.

    Returns None if the page is empty or fails quality checks.
    """
    if not html.strip():
        return None

    text = trafilatura.extract(html, include_comments=False, include_tables=False)
    if not text or not is_quality_content(text):
        return None

    metadata = trafilatura.extract_metadata(html)
    title: str = metadata.title if (metadata and metadata.title) else ""
    published_date = metadata.date if (metadata and metadata.date) else None

    return PageContent(
        url=url,
        text=text,
        title=title,
        published_date=published_date,
        source_type=_infer_source_type(url, title),
    )


def is_quality_content(text: str) -> bool:
    """Return True if the text meets minimum quality requirements."""
    if len(text.split()) < MIN_WORD_COUNT:
        return False
    if LOGIN_PATTERNS.search(text[:500]):
        return False
    return True


def _infer_source_type(url: str, title: str | None) -> SourceType:
    lowered = f"{url} {title or ''}".lower()
    if "podcast" in lowered:
        return SourceType.PODCAST
    if "report" in lowered or "pdf" in lowered:
        return SourceType.REPORT
    if "gov" in lowered:
        return SourceType.GOVERNMENT_RECORD
    if "youtube" in lowered or "video" in lowered:
        return SourceType.VIDEO
    if any(s in lowered for s in ("twitter.com", "x.com", "instagram.com")):
        return SourceType.SOCIAL_MEDIA
    return SourceType.NEWS_ARTICLE
