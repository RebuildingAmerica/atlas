"""Article record normalization helpers for Scout."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any
from urllib.parse import urlparse

from atlas_shared import PageContent, SourceType

from atlas_scout.articles.guardian_records import guardian_articles_from_response
from atlas_scout.articles.mentions import (
    extract_article_mentions,
    optional_article_text,
    plain_article_text,
)
from atlas_scout.articles.urls import canonicalize_article_url

__all__ = [
    "crawled_article_from_page",
    "guardian_articles_from_response",
    "is_article_utility_page",
    "plain_article_text",
]

_GUARDIAN_BODY_TEXT_EXCERPT_CHARS = 500
_UTILITY_ARTICLE_TITLES = {
    "advertise",
    "contact us",
    "privacy policy",
    "sitemap",
    "sponsor content hub",
    "terms of service",
}
_UTILITY_ARTICLE_PATH_SEGMENTS = {
    "advertise",
    "contact",
    "contact-us",
    "privacy",
    "privacy-policy",
    "sitemap",
    "sponsor-content-hub",
    "terms",
    "terms-of-service",
}


def crawled_article_from_page(
    page: PageContent,
    *,
    seed_url: str,
    crawl_depth: int,
    from_date: date | None,
    to_date: date | None,
) -> dict[str, Any] | None:
    """Convert one fetched news article page into a local article record."""
    if page.source_type != SourceType.NEWS_ARTICLE:
        return None
    published_at = _page_published_datetime(page)
    if published_at is None:
        return None
    published_date = published_at.date()
    if from_date is not None and published_date < from_date:
        return None
    if to_date is not None and published_date > to_date:
        return None

    url = canonicalize_article_url(page.url)
    parsed_url = urlparse(url)
    if not parsed_url.netloc:
        return None
    title = _page_article_title(page)
    body_text = plain_article_text(page.text)
    if not title or not body_text:
        return None
    trail_text = _page_article_description(page)
    publication = _page_article_publication(page)
    schema_types = _page_schema_types(page)
    if is_article_utility_page(url=url, title=title, schema_types=schema_types):
        return None
    metadata = {
        "discovery_method": "crawl",
        "seed_url": seed_url,
        "crawl_depth": crawl_depth,
        "source_type": str(page.source_type),
        "publication": publication,
        "trail_text": trail_text,
        "body_text_length": len(body_text),
        "body_text_excerpt": body_text[:_GUARDIAN_BODY_TEXT_EXCERPT_CHARS],
        "schema_types": schema_types,
        "opengraph_type": _page_opengraph_value(page, "type"),
        "mentions": extract_article_mentions(
            title=title,
            trail_text=trail_text,
            body_text=body_text,
        ),
    }
    return {
        "url": url,
        "title": title,
        "published_at": published_at.isoformat(),
        "source_name": publication or parsed_url.netloc.lower(),
        "source_domain": parsed_url.netloc.lower(),
        "section": article_section_from_url(url),
        "provider": "crawl",
        "provider_id": url,
        "api_url": None,
        "metadata": metadata,
    }


def _page_article_title(page: PageContent) -> str:
    """Return the best title for a crawled article page."""
    title = plain_article_text(page.title)
    if title:
        return title
    og_title = _page_opengraph_value(page, "title")
    if og_title:
        return og_title
    for item in _page_jsonld_items(page):
        headline = optional_article_text(item.get("headline"))
        if headline:
            return headline
    return ""


def is_article_utility_page(*, url: str, title: str, schema_types: list[str]) -> bool:
    """Return whether a crawled page is site chrome, not an article."""
    normalized_title = title.strip().casefold()
    if normalized_title in _UTILITY_ARTICLE_TITLES:
        return True
    path_segments = {
        segment.strip().casefold() for segment in urlparse(url).path.split("/") if segment.strip()
    }
    if path_segments & _UTILITY_ARTICLE_PATH_SEGMENTS:
        return True
    normalized_schema_types = {schema_type.casefold() for schema_type in schema_types}
    return (
        normalized_title in {"home", "homepage"}
        and "newsarticle" not in normalized_schema_types
        and "article" not in normalized_schema_types
    )


def _page_article_description(page: PageContent) -> str:
    """Return an article summary from structured metadata when available."""
    for key in ("description", "og:description"):
        description = _page_opengraph_value(page, key)
        if description:
            return description
    twitter_card = page.structured_data.get("twitter_card")
    if isinstance(twitter_card, dict):
        description = optional_article_text(twitter_card.get("description"))
        if description:
            return description
    for item in _page_jsonld_items(page):
        description = optional_article_text(item.get("description"))
        if description:
            return description
    return ""


def _page_article_publication(page: PageContent) -> str:
    """Return publication/site name from extracted metadata."""
    publication = optional_article_text(page.publication)
    if publication:
        return publication
    site_name = _page_opengraph_value(page, "site_name")
    if site_name:
        return site_name
    for item in _page_jsonld_items(page):
        publisher = item.get("publisher")
        if isinstance(publisher, dict):
            name = optional_article_text(publisher.get("name"))
            if name:
                return name
    return ""


def _page_published_datetime(page: PageContent) -> datetime | None:
    """Return a publication datetime from extracted page metadata."""
    for item in _page_jsonld_items(page):
        for key in ("datePublished", "dateCreated", "dateModified"):
            parsed = _parse_article_datetime(item.get(key))
            if parsed is not None:
                return parsed
    for key in ("published_time", "article:published_time"):
        parsed = _parse_article_datetime(_page_opengraph_value(page, key))
        if parsed is not None:
            return parsed
    if page.published_date is not None:
        return page.published_date
    return None


def _parse_article_datetime(value: object) -> datetime | None:
    """Parse ISO-ish article datetimes from structured metadata."""
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        try:
            parsed_date = date.fromisoformat(normalized[:10])
        except ValueError:
            return None
        return datetime(parsed_date.year, parsed_date.month, parsed_date.day, tzinfo=UTC)


def _page_schema_types(page: PageContent) -> list[str]:
    """Return schema.org @type values extracted from JSON-LD."""
    types: list[str] = []
    seen: set[str] = set()
    for item in _page_jsonld_items(page):
        raw_type = item.get("@type")
        values = raw_type if isinstance(raw_type, list) else [raw_type]
        for value in values:
            if not isinstance(value, str) or value in seen:
                continue
            seen.add(value)
            types.append(value)
    return types


def _page_jsonld_items(page: PageContent) -> list[dict[str, Any]]:
    """Return JSON-LD dicts, including entries nested under @graph."""
    raw_items = page.structured_data.get("jsonld")
    if not isinstance(raw_items, list):
        return []
    items: list[dict[str, Any]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        items.append(item)
        graph = item.get("@graph")
        if isinstance(graph, list):
            items.extend(graph_item for graph_item in graph if isinstance(graph_item, dict))
    return items


def _page_opengraph_value(page: PageContent, key: str) -> str:
    """Return a stripped OpenGraph field value."""
    opengraph = page.structured_data.get("opengraph")
    if not isinstance(opengraph, dict):
        return ""
    return optional_article_text(opengraph.get(key))


def article_section_from_url(url: str) -> str | None:
    """Return the first path segment as a compact source section label."""
    parsed_path = urlparse(url).path.strip("/")
    if not parsed_path:
        return None
    return parsed_path.split("/", maxsplit=1)[0] or None
