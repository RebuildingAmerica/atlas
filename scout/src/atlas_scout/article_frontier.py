"""Article crawl frontier ordering and queue helpers."""

from __future__ import annotations

import re
from calendar import monthrange
from collections import deque
from dataclasses import dataclass
from datetime import date
from typing import Any
from urllib.parse import urlparse

from atlas_scout.article_urls import canonicalize_article_url

_ARTICLE_CRAWL_DAY_DATE_PATTERN = re.compile(
    r"(?<!\d)(?P<year>19\d{2}|20\d{2})[/-](?P<month>0?[1-9]|1[0-2])[/-]"
    r"(?P<day>0?[1-9]|[12]\d|3[01])(?!\d)"
)
_ARTICLE_CRAWL_MONTH_DATE_PATTERN = re.compile(
    r"(?<!\d)(?P<year>19\d{2}|20\d{2})[/-](?P<month>0?[1-9]|1[0-2])"
    r"(?![/-]?\d)"
)
_ARTICLE_CRAWL_YEAR_PATTERN = re.compile(r"^(19\d{2}|20\d{2})$")
_COLLECTION_PATH_SEGMENTS = {
    "author",
    "authors",
    "by",
    "category",
    "categories",
    "collection",
    "collections",
    "columnist",
    "columnists",
    "feed",
    "feeds",
    "games",
    "markets",
    "newsletter",
    "newsletters",
    "personal-finance",
    "photo",
    "photos",
    "podcast",
    "podcasts",
    "puzzle",
    "puzzles",
    "real-estate",
    "recipe",
    "recipes",
    "rss",
    "section",
    "sections",
    "sports",
    "style",
    "tag",
    "tags",
    "topic",
    "topics",
    "type",
    "types",
    "video",
    "videos",
}


@dataclass(frozen=True)
class ArticleCrawlBatch:
    """A bounded crawl batch plus URLs skipped before network fetch."""

    items: list[tuple[str, str, int]]
    skipped_by_domain_cap: int
    skipped_existing: int


def article_frontier_item(
    *,
    url: str,
    seed_url: str,
    depth: int,
    priority: int | None = None,
) -> dict[str, Any]:
    """Return a persisted article frontier record for one discovered URL."""
    return {
        "url": url,
        "seed_url": seed_url,
        "depth": depth,
        "priority": article_frontier_priority(url) if priority is None else priority,
        "source_domain": urlparse(url).netloc.lower(),
    }


def source_seed_frontier_priority(url: str) -> int:
    """Score operator-provided source seeds ahead of low-value backlog URLs."""
    if article_crawl_is_discovery_resource(url):
        return 15
    return article_frontier_priority(url)


def next_article_crawl_batch(
    queue: deque[tuple[str, str, int]],
    seen: set[str],
    *,
    batch_limit: int,
    max_per_domain: int,
    blocked_domains: set[str],
    existing_article_urls: set[str],
) -> ArticleCrawlBatch:
    """Pop a bounded crawl batch while limiting concurrent work per domain."""
    crawl_batch: list[tuple[str, str, int]] = []
    deferred: deque[tuple[str, str, int]] = deque()
    domain_counts: dict[str, int] = {}
    skipped_existing = 0
    skipped_by_domain_cap = 0
    scanned = 0
    scan_limit = max(batch_limit * 100, batch_limit)
    while queue and len(crawl_batch) < batch_limit and scanned < scan_limit:
        scanned += 1
        url, seed_url, depth = queue.popleft()
        if url in seen:
            continue
        if url in existing_article_urls:
            seen.add(url)
            skipped_existing += 1
            continue
        domain = urlparse(url).netloc.lower()
        if domain in blocked_domains:
            seen.add(url)
            skipped_by_domain_cap += 1
            continue
        if domain_counts.get(domain, 0) >= max_per_domain:
            deferred.append((url, seed_url, depth))
            continue
        seen.add(url)
        domain_counts[domain] = domain_counts.get(domain, 0) + 1
        crawl_batch.append((url, seed_url, depth))

    while deferred:
        queue.appendleft(deferred.pop())
    return ArticleCrawlBatch(
        items=crawl_batch,
        skipped_by_domain_cap=skipped_by_domain_cap,
        skipped_existing=skipped_existing,
    )


def article_crawl_blocked_domains(
    domain_saved_counts: dict[str, int],
    *,
    max_save_per_domain: int | None,
) -> set[str]:
    """Return domains that already reached the current corpus save cap."""
    if max_save_per_domain is None:
        return set()
    return {
        domain
        for domain, saved_count in domain_saved_counts.items()
        if saved_count >= max_save_per_domain
    }


def article_crawl_domain_at_cap(
    domain: str,
    domain_saved_counts: dict[str, int],
    *,
    max_save_per_domain: int | None,
) -> bool:
    """Return whether saving another article from the domain would exceed the cap."""
    return (
        max_save_per_domain is not None
        and domain_saved_counts.get(domain, 0) >= max_save_per_domain
    )


def article_crawl_is_discovery_resource(url: str) -> bool:
    """Return whether a discovered URL should stay behind likely article pages."""
    parsed = urlparse(url)
    path = parsed.path.lower()
    if path.endswith("/robots.txt"):
        return True
    if path.endswith((".xml", ".xml.gz", ".rss", ".atom")):
        return True
    if "sitemap" in path:
        return True
    return path.endswith(("/feed", "/rss", "/atom"))


def article_crawl_url_outside_date_window(
    url: str,
    *,
    from_date: date | None,
    to_date: date | None,
) -> bool:
    """Return whether a discovered URL can be safely pruned by path date."""
    if from_date is None and to_date is None:
        return False
    inferred = article_crawl_url_date_span(url)
    if inferred is None:
        return False
    start, end = inferred
    if from_date is not None and end < from_date:
        return True
    return to_date is not None and start > to_date


def article_crawl_url_date_span(url: str) -> tuple[date, date] | None:
    """Infer an article/archive date span from common news URL path patterns."""
    path = urlparse(url).path
    day_match = _ARTICLE_CRAWL_DAY_DATE_PATTERN.search(path)
    if day_match is not None:
        try:
            matched_date = date(
                int(day_match.group("year")),
                int(day_match.group("month")),
                int(day_match.group("day")),
            )
        except ValueError:
            return None
        return matched_date, matched_date

    month_match = _ARTICLE_CRAWL_MONTH_DATE_PATTERN.search(path)
    if month_match is not None:
        year = int(month_match.group("year"))
        month = int(month_match.group("month"))
        return date(year, month, 1), date(year, month, monthrange(year, month)[1])

    for segment in path.split("/"):
        stem = segment.rsplit(".", maxsplit=1)[0]
        if _ARTICLE_CRAWL_YEAR_PATTERN.fullmatch(stem):
            year = int(stem)
            return date(year, 1, 1), date(year, 12, 31)
    return None


def article_frontier_priority(url: str) -> int:
    """Score pending frontier URLs so likely article pages are fetched first."""
    normalized = canonicalize_article_url(url)
    if article_crawl_is_discovery_resource(normalized):
        return 0

    date_span = article_crawl_url_date_span(normalized)
    if date_span is not None:
        start, end = date_span
        if start == end:
            return 100
        if start.month == end.month:
            return 70
        return 40

    if _has_collection_path_segment(normalized):
        return 1
    if _has_article_like_slug(normalized):
        return 20
    return 5


def _has_collection_path_segment(url: str) -> bool:
    """Return whether a path segment looks like an index, section, or author page."""
    path_segments = [
        segment for segment in urlparse(url).path.lower().strip("/").split("/") if segment
    ]
    return any(segment in _COLLECTION_PATH_SEGMENTS for segment in path_segments)


def _has_article_like_slug(url: str) -> bool:
    """Return whether a URL has a terminal slug shaped like a news article."""
    final_segment = urlparse(url).path.lower().strip("/").rsplit("/", maxsplit=1)[-1]
    if not final_segment:
        return False
    stem = final_segment.rsplit(".", maxsplit=1)[0]
    if stem in _COLLECTION_PATH_SEGMENTS:
        return False
    return stem.count("-") >= 3 or len(stem) >= 28
