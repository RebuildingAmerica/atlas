"""Shared Scout HTML quality, metadata and frontier rules.

Keeping these rules shared protects source provenance when research resumes on
another runtime. Text extraction stays caller-owned; no parser SDK is loaded
by importing the shared discovery package.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime
from html.parser import HTMLParser
from typing import Any, Protocol
from urllib.parse import urldefrag, urljoin, urlparse

from atlas_shared import PageContent, SourceType


class HtmlMetadata(Protocol):
    """Metadata returned by the caller's HTML parser."""

    @property
    def title(self) -> str | None: ...

    @property
    def sitename(self) -> str | None: ...

    @property
    def date(self) -> str | None: ...


MIN_WORD_COUNT = 50
LOGIN_PATTERNS = re.compile(
    r"(please (log|sign) in|create an account|subscribe to continue|paywall)",
    re.IGNORECASE,
)


@dataclass(slots=True)
class ContentExtraction:
    """Structured extraction result for one HTML response."""

    page: PageContent | None
    reason: str | None
    discovered_links: list[str]


def normalize_url(url: str) -> str:
    """Normalize URLs for frontier dedupe."""
    stripped = url.strip()
    if not stripped:
        return ""
    normalized, _fragment = urldefrag(stripped)
    parsed = urlparse(normalized)
    if parsed.path == "/" and not parsed.params and not parsed.query:
        normalized = parsed._replace(path="").geturl()
    return normalized


def same_domain(base_url: str, candidate_url: str) -> bool:
    """Return True when two URLs share the same HTTP(S) host."""
    base = urlparse(base_url)
    candidate = urlparse(candidate_url)
    if candidate.scheme not in {"http", "https"}:
        return False
    return base.netloc == candidate.netloc


class _LinkExtractor(HTMLParser):
    """Simple HTML parser that collects href values from anchor tags."""

    def __init__(self) -> None:
        """Initialize the parser with an empty link list."""
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Collect href values from anchor tags."""
        if tag == "a":
            for name, value in attrs:
                if name == "href" and value:
                    self.links.append(value)


def extract_links(html: str, base_url: str, same_domain: bool = True) -> list[str]:
    """Extract absolute, deduplicated links from HTML.

    Filters to same-domain links by default and strips URL fragments.
    """
    parser = _LinkExtractor()
    parser.feed(html)

    base_domain = urlparse(base_url).netloc
    seen: set[str] = set()
    result: list[str] = []

    for raw in parser.links:
        absolute = urljoin(base_url, raw)
        parsed = urlparse(absolute)
        if parsed.scheme not in ("http", "https"):
            continue
        if same_domain and parsed.netloc != base_domain:
            continue
        normalized = normalize_url(parsed._replace(fragment="").geturl())
        if normalized not in seen:
            seen.add(normalized)
            result.append(normalized)

    return result


def extract_html_content(
    html: str,
    url: str,
    *,
    text_reader: Callable[[str], str | None],
    metadata_reader: Callable[[str], HtmlMetadata | None],
) -> ContentExtraction:
    """Extract page content plus skip reason and same-domain discovered links."""
    discovered_links = extract_links(html, base_url=url, same_domain=True) if html.strip() else []
    if not html.strip():
        return ContentExtraction(page=None, reason="empty_body", discovered_links=discovered_links)

    # Extract structured data (JSON-LD, OpenGraph) BEFORE trafilatura flattens HTML
    structured = extract_structured_data(html)

    text = text_reader(html)
    if not text:
        return ContentExtraction(
            page=None,
            reason="content_not_extractable",
            discovered_links=discovered_links,
        )

    quality_reason = content_quality_reason(text)
    if quality_reason is not None:
        return ContentExtraction(
            page=None, reason=quality_reason, discovered_links=discovered_links
        )

    metadata = metadata_reader(html)
    title: str = metadata.title if (metadata and metadata.title) else ""
    publication: str | None = metadata.sitename if (metadata and metadata.sitename) else None
    published_date = _parse_metadata_datetime(metadata.date if metadata else None)

    return ContentExtraction(
        page=PageContent(
            url=url,
            text=text,
            title=title,
            publication=publication,
            published_date=published_date,
            source_type=_infer_source_type(url, structured),
            discovered_links=discovered_links,
            structured_data=structured,
        ),
        reason=None,
        discovered_links=discovered_links,
    )


def is_quality_content(text: str) -> bool:
    """Return True if the text meets minimum quality requirements."""
    return content_quality_reason(text) is None


def content_quality_reason(text: str) -> str | None:
    """Return ``None`` for acceptable content, otherwise a machine-readable reason."""
    if len(text.split()) < MIN_WORD_COUNT:
        return "content_below_min_words"
    if LOGIN_PATTERNS.search(text):
        return "login_or_paywall"
    return None


class _StructuredDataParser(HTMLParser):
    """Extract JSON-LD and OpenGraph/Twitter Card metadata from raw HTML."""

    def __init__(self) -> None:
        super().__init__()
        self._in_jsonld = False
        self._jsonld_chunks: list[str] = []
        self.jsonld: list[dict[str, Any]] = []
        self.opengraph: dict[str, str] = {}
        self.twitter_card: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_dict = {k: v for k, v in attrs if v is not None}
        if tag == "script" and attr_dict.get("type") == "application/ld+json":
            self._in_jsonld = True
            self._jsonld_chunks = []
        elif tag == "meta":
            prop = attr_dict.get("property", "")
            name = attr_dict.get("name", "")
            content = attr_dict.get("content", "")
            if prop.startswith("og:"):
                self.opengraph[prop[3:]] = content
            elif name.startswith("twitter:"):
                self.twitter_card[name[8:]] = content

    def handle_data(self, data: str) -> None:
        if self._in_jsonld:
            self._jsonld_chunks.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._in_jsonld:
            self._in_jsonld = False
            raw = "".join(self._jsonld_chunks).strip()
            self._jsonld_chunks = []
            if raw:
                try:
                    parsed = json.loads(raw)
                    if isinstance(parsed, list):
                        self.jsonld.extend(parsed)
                    else:
                        self.jsonld.append(parsed)
                except json.JSONDecodeError:
                    pass


def extract_structured_data(html: str) -> dict[str, Any]:
    """Extract JSON-LD, OpenGraph, and Twitter Card metadata from raw HTML.

    Returns a dict with optional keys: ``jsonld``, ``opengraph``, ``twitter_card``.
    Empty keys are omitted.
    """
    parser = _StructuredDataParser()
    with suppress(Exception):
        parser.feed(html)

    result: dict[str, Any] = {}
    if parser.jsonld:
        result["jsonld"] = parser.jsonld
    if parser.opengraph:
        result["opengraph"] = parser.opengraph
    if parser.twitter_card:
        result["twitter_card"] = parser.twitter_card
    return result


def _infer_source_type(url: str, structured_data: dict[str, Any] | None = None) -> SourceType:
    """Classify source type from structured metadata, falling back to WEBSITE.

    Uses OpenGraph ``og:type``, schema.org ``@type``, and URL domain as
    signals. Does NOT guess from keywords in the title or URL path.
    """
    # Check structured data first (most reliable)
    if structured_data:
        og_type = structured_data.get("opengraph", {}).get("type", "").lower()
        if og_type in ("article", "news"):
            return SourceType.NEWS_ARTICLE
        if og_type == "video":
            return SourceType.VIDEO

        for item in structured_data.get("jsonld", []):
            schema_type = str(item.get("@type", "")).lower()
            if schema_type in ("newsarticle", "article", "reportagenewsarticle"):
                return SourceType.NEWS_ARTICLE
            if schema_type in ("videoobject",):
                return SourceType.VIDEO
            if schema_type in ("podcastepisode", "podcastseries"):
                return SourceType.PODCAST
            if schema_type in ("report", "technicalarticle", "scholarlyarticle"):
                return SourceType.REPORT

    domain = urlparse(url).netloc.lower()
    social_domains = {
        "twitter.com",
        "x.com",
        "instagram.com",
        "facebook.com",
        "linkedin.com",
        "tiktok.com",
    }
    video_domains = {"youtube.com", "youtu.be", "vimeo.com"}
    gov_tlds = (".gov", ".gov.uk", ".gob.mx", ".gc.ca")

    if any(domain == d or domain.endswith("." + d) for d in social_domains):
        return SourceType.SOCIAL_MEDIA
    if any(domain == d or domain.endswith("." + d) for d in video_domains):
        return SourceType.VIDEO
    if any(domain.endswith(tld) for tld in gov_tlds):
        return SourceType.GOVERNMENT_RECORD

    return SourceType.WEBSITE


def _parse_metadata_datetime(value: str | None) -> datetime | None:
    """Best-effort datetime parsing for trafilatura metadata."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None
