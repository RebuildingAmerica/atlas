"""Convert stored article corpus rows into extraction-ready Scout pages."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from atlas_shared import PageContent, SourceType

from atlas_scout.articles.mentions import plain_article_text

_MIN_LOCAL_ARTICLE_TEXT_CHARS = 80


def article_page_from_record(article: dict[str, Any]) -> PageContent | None:
    """Build a PageContent record from a stored article row when text is available."""
    metadata = article.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    text = _article_text(article, metadata)
    if len(text) < _MIN_LOCAL_ARTICLE_TEXT_CHARS:
        return None

    published_at = _article_published_at(article.get("published_at"))
    structured_data = {
        "article_id": str(article.get("id") or ""),
        "article_provider": str(article.get("provider") or ""),
        "article_provider_id": str(article.get("provider_id") or ""),
        "source_domain": str(article.get("source_domain") or ""),
        "source_name": str(article.get("source_name") or ""),
        "section": str(article.get("section") or ""),
    }
    return PageContent(
        url=str(article["url"]),
        title=str(article.get("title") or ""),
        text=text,
        publication=str(article.get("source_name") or "") or None,
        published_date=published_at,
        source_type=SourceType.NEWS_ARTICLE,
        structured_data=structured_data,
    )


def _article_text(article: dict[str, Any], metadata: dict[str, Any]) -> str:
    parts = [
        str(article.get("title") or ""),
        str(metadata.get("trail_text") or ""),
        str(metadata.get("body_text") or metadata.get("body_text_excerpt") or ""),
    ]
    return plain_article_text(" ".join(part for part in parts if part))


def _article_published_at(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None
