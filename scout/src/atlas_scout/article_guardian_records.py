"""Guardian Content API article record mapping."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from atlas_scout.article_mentions import (
    extract_article_mentions,
    optional_article_text,
    plain_article_text,
)
from atlas_scout.article_urls import canonicalize_article_url

_GUARDIAN_BODY_TEXT_EXCERPT_CHARS = 500


def guardian_articles_from_response(response: dict[str, Any]) -> list[dict[str, Any]]:
    """Map Guardian Content API results to local article records."""
    results = response.get("results")
    if not isinstance(results, list):
        return []
    articles: list[dict[str, Any]] = []
    for item in results:
        if not isinstance(item, dict) or item.get("type") != "article":
            continue
        url = item.get("webUrl")
        title = item.get("webTitle")
        published_at = item.get("webPublicationDate")
        if (
            not isinstance(url, str)
            or not isinstance(title, str)
            or not isinstance(published_at, str)
        ):
            continue
        canonical_url = canonicalize_article_url(url)
        parsed_url = urlparse(canonical_url)
        if not parsed_url.netloc:
            continue
        fields = item.get("fields")
        fields = fields if isinstance(fields, dict) else {}
        title_text = plain_article_text(title)
        trail_text = plain_article_text(fields.get("trailText"))
        body_text = plain_article_text(fields.get("bodyText"))
        metadata = {
            "guardian_id": item.get("id"),
            "section_id": item.get("sectionId"),
            "pillar_name": item.get("pillarName"),
            "trail_text": trail_text,
            "byline": plain_article_text(fields.get("byline")),
            "short_url": optional_article_text(fields.get("shortUrl")),
            "thumbnail": optional_article_text(fields.get("thumbnail")),
            "body_text_length": len(body_text),
            "body_text_excerpt": body_text[:_GUARDIAN_BODY_TEXT_EXCERPT_CHARS],
            "guardian_tags": _guardian_tags_from_item(item),
            "mentions": extract_article_mentions(
                title=title_text,
                trail_text=trail_text,
                body_text=body_text,
            ),
        }
        articles.append(
            {
                "url": canonical_url,
                "title": title_text,
                "published_at": published_at,
                "source_name": "The Guardian",
                "source_domain": parsed_url.netloc.lower(),
                "section": item.get("sectionName"),
                "provider": "guardian",
                "provider_id": item.get("id"),
                "api_url": item.get("apiUrl"),
                "metadata": metadata,
            }
        )
    return articles


def _guardian_tags_from_item(item: dict[str, Any]) -> list[dict[str, str]]:
    """Return Guardian taxonomy tags as provider metadata."""
    tags = item.get("tags")
    if not isinstance(tags, list):
        return []

    results: list[dict[str, str]] = []
    for tag in tags:
        if not isinstance(tag, dict):
            continue
        tag_id = optional_article_text(tag.get("id"))
        tag_type = optional_article_text(tag.get("type"))
        tag_title = optional_article_text(tag.get("webTitle"))
        if not tag_id and not tag_type and not tag_title:
            continue
        results.append({"id": tag_id, "type": tag_type, "title": tag_title})
    return results
