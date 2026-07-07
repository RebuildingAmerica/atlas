"""Article records extracted from sitemap and feed discovery metadata."""

from __future__ import annotations

import gzip
from datetime import UTC, date, datetime
from typing import Any
from urllib.parse import unquote, urlparse
from xml.etree import ElementTree

from atlas_scout.article_frontier import (
    article_crawl_is_discovery_resource,
    article_crawl_url_date_span,
)
from atlas_scout.article_mentions import extract_article_mentions, plain_article_text
from atlas_scout.article_records import _article_section_from_url
from atlas_scout.article_urls import canonicalize_article_url

_DISCOVERY_CONTENT_TYPES = {
    "application/atom+xml",
    "application/rss+xml",
    "application/sitemap+xml",
    "application/xml",
    "text/xml",
}


def discovery_articles_from_resource(
    body: bytes,
    *,
    url: str,
    content_type: str,
    from_date: date | None = None,
    to_date: date | None = None,
) -> list[dict[str, Any]]:
    """Return source-backed article rows from sitemap/feed metadata."""
    if not _looks_like_discovery_resource(url=url, content_type=content_type, body=body):
        return []
    text = _decode_discovery_body(body)
    if not text.strip():
        return []
    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError:
        return []
    if _local_name(root.tag) != "urlset":
        return []
    articles: list[dict[str, Any]] = []
    for element in root.iter():
        if _local_name(element.tag) != "url":
            continue
        if _direct_child(element, "news") is not None:
            article = _news_sitemap_article(
                element,
                seed_url=url,
                from_date=from_date,
                to_date=to_date,
            )
        else:
            article = _url_derived_sitemap_article(
                element,
                seed_url=url,
                from_date=from_date,
                to_date=to_date,
            )
        if article is not None:
            articles.append(article)
    return articles


def _news_sitemap_article(
    element: ElementTree.Element,
    *,
    seed_url: str,
    from_date: date | None,
    to_date: date | None,
) -> dict[str, Any] | None:
    loc = _direct_child_text(element, "loc")
    news = _direct_child(element, "news")
    if not loc or news is None:
        return None
    title = plain_article_text(_direct_child_text(news, "title"))
    published_at = _parse_datetime(_direct_child_text(news, "publication_date"))
    if not title or published_at is None:
        return None
    published_date = published_at.date()
    if from_date is not None and published_date < from_date:
        return None
    if to_date is not None and published_date > to_date:
        return None

    article_url = canonicalize_article_url(loc)
    parsed_url = urlparse(article_url)
    if not parsed_url.netloc:
        return None
    publication = _news_publication_name(news) or parsed_url.netloc.lower()
    keywords = plain_article_text(_direct_child_text(news, "keywords"))
    mentions = extract_article_mentions(title=title, trail_text=keywords, body_text="")
    if not mentions:
        return None
    metadata = {
        "discovery_method": "crawl",
        "extraction_method": "news_sitemap",
        "seed_url": seed_url,
        "source_type": "news_sitemap",
        "publication": publication,
        "trail_text": keywords,
        "mentions": mentions,
    }
    return {
        "url": article_url,
        "title": title,
        "published_at": published_at.isoformat(),
        "source_name": publication,
        "source_domain": parsed_url.netloc.lower(),
        "section": _article_section_from_url(article_url),
        "provider": "crawl",
        "provider_id": article_url,
        "api_url": None,
        "metadata": metadata,
    }


def _news_publication_name(news: ElementTree.Element) -> str:
    publication = _direct_child(news, "publication")
    if publication is None:
        return ""
    return plain_article_text(_direct_child_text(publication, "name"))


def _url_derived_sitemap_article(
    element: ElementTree.Element,
    *,
    seed_url: str,
    from_date: date | None,
    to_date: date | None,
) -> dict[str, Any] | None:
    loc = _direct_child_text(element, "loc")
    if not loc:
        return None
    return url_derived_article_record(
        loc,
        seed_url=seed_url,
        from_date=from_date,
        to_date=to_date,
        extraction_method="sitemap_url",
        source_type="sitemap",
        lastmod=_direct_child_text(element, "lastmod"),
    )


def url_derived_article_record(
    url: str,
    *,
    seed_url: str,
    from_date: date | None,
    to_date: date | None,
    extraction_method: str,
    source_type: str,
    lastmod: str = "",
) -> dict[str, Any] | None:
    """Return a lower-confidence article row inferred from a dated URL slug."""
    article_url = canonicalize_article_url(url)
    if article_crawl_is_discovery_resource(article_url):
        return None
    date_span = article_crawl_url_date_span(article_url)
    if date_span is None:
        return None
    published_date, published_end = date_span
    if published_date != published_end:
        return None
    if from_date is not None and published_date < from_date:
        return None
    if to_date is not None and published_date > to_date:
        return None
    title = _title_from_dated_url(article_url, published_date)
    if not title:
        return None
    mentions = extract_article_mentions(title=title, trail_text="", body_text="")
    if not mentions:
        return None
    parsed_url = urlparse(article_url)
    if not parsed_url.netloc:
        return None
    published_at = datetime(
        published_date.year, published_date.month, published_date.day, tzinfo=UTC
    )
    source_name = parsed_url.netloc.lower()
    metadata = {
        "confidence": "url_derived",
        "discovery_method": "crawl",
        "extraction_method": extraction_method,
        "seed_url": seed_url,
        "source_type": source_type,
        "publication": source_name,
        "sitemap_lastmod": lastmod,
        "mentions": mentions,
    }
    return {
        "url": article_url,
        "title": title,
        "published_at": published_at.isoformat(),
        "source_name": source_name,
        "source_domain": source_name,
        "section": _article_section_from_url(article_url),
        "provider": "crawl",
        "provider_id": article_url,
        "api_url": None,
        "metadata": metadata,
    }


def _title_from_dated_url(url: str, published_date: date) -> str:
    segments = [segment for segment in urlparse(url).path.split("/") if segment]
    for index in range(max(len(segments) - 2, 0)):
        if not _segments_match_date(segments[index : index + 3], published_date):
            continue
        slug_segments = segments[index + 3 :]
        if not slug_segments:
            return ""
        slug = slug_segments[-1].rsplit(".", maxsplit=1)[0]
        words = [word for word in unquote(slug).replace("_", "-").split("-") if word]
        if len(words) < 2:
            return ""
        return " ".join(word.capitalize() for word in words if not word.isdigit())
    return ""


def _segments_match_date(segments: list[str], published_date: date) -> bool:
    if len(segments) != 3:
        return False
    try:
        year = int(segments[0])
        month = int(segments[1])
        day = int(segments[2])
    except ValueError:
        return False
    return (year, month, day) == (published_date.year, published_date.month, published_date.day)


def _direct_child(element: ElementTree.Element, name: str) -> ElementTree.Element | None:
    for child in list(element):
        if _local_name(child.tag) == name:
            return child
    return None


def _direct_child_text(element: ElementTree.Element, name: str) -> str:
    child = _direct_child(element, name)
    if child is None or child.text is None:
        return ""
    return child.text.strip()


def _parse_datetime(value: str) -> datetime | None:
    if not value:
        return None
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        try:
            parsed_date = date.fromisoformat(normalized[:10])
        except ValueError:
            return None
        return datetime(parsed_date.year, parsed_date.month, parsed_date.day, tzinfo=UTC)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _looks_like_discovery_resource(*, url: str, content_type: str, body: bytes) -> bool:
    normalized_content_type = content_type.split(";", maxsplit=1)[0].strip().lower()
    parsed_path = urlparse(url).path.lower()
    if normalized_content_type in _DISCOVERY_CONTENT_TYPES:
        return True
    if parsed_path.endswith((".xml", ".xml.gz", ".rss", ".atom")):
        return True
    stripped = body.lstrip()
    return stripped.startswith((b"<?xml", b"<rss", b"<feed"))


def _decode_discovery_body(body: bytes) -> str:
    if body.startswith(b"\x1f\x8b"):
        try:
            body = gzip.decompress(body)
        except OSError:
            return ""
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return body.decode(encoding)
        except UnicodeDecodeError:
            continue
    return body.decode("utf-8", errors="replace")


def _local_name(tag: str) -> str:
    return tag.rsplit("}", maxsplit=1)[-1].lower()
