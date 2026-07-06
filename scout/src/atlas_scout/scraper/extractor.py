"""HTML extraction helpers with explicit quality reasons and discovered links."""

from __future__ import annotations

import json
import re
import zipfile
from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime
from html.parser import HTMLParser
from io import BytesIO
from typing import Any
from urllib.parse import unquote, urlparse

import trafilatura
from atlas_shared import PageContent, SourceType

from atlas_scout.scraper.crawler import extract_links

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


def extract_content(html: str, url: str) -> PageContent | None:
    """Extract clean text content from HTML or return ``None`` on failure."""
    return extract_content_verbose(html, url).page


def extract_content_verbose(html: str, url: str) -> ContentExtraction:
    """Extract page content plus skip reason and same-domain discovered links."""
    discovered_links = extract_links(html, base_url=url, same_domain=True) if html.strip() else []
    if not html.strip():
        return ContentExtraction(page=None, reason="empty_body", discovered_links=discovered_links)

    # Extract structured data (JSON-LD, OpenGraph) BEFORE trafilatura flattens HTML
    structured = extract_structured_data(html)

    text = trafilatura.extract(html, include_comments=False, include_tables=True)
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

    metadata = trafilatura.extract_metadata(html)
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


def extract_structured_content(
    body: bytes,
    *,
    url: str,
    content_type: str,
) -> ContentExtraction | None:
    """Extract raw structured text resources such as CSV, TSV, pipe files, and ZIPs."""
    normalized_content_type = content_type.split(";", maxsplit=1)[0].strip().lower()
    parsed_path = urlparse(url).path.lower()

    if normalized_content_type in {"application/zip", "application/x-zip-compressed"} or (
        parsed_path.endswith(".zip")
    ):
        return _extract_zip_structured_content(body, url=url)

    if normalized_content_type in {
        "text/csv",
        "application/csv",
        "text/tab-separated-values",
        "text/plain",
    } or parsed_path.endswith((".csv", ".tsv", ".psv")):
        text = _decode_structured_text(body)
        if not _looks_like_delimited_text(text):
            return None
        return _structured_page(
            url=url,
            title=_resource_title(url),
            text=text,
            resource_format=_resource_format_for_url(url, normalized_content_type),
        )

    return None


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


def _extract_zip_structured_content(body: bytes, *, url: str) -> ContentExtraction | None:
    """Return the first delimited text member from a ZIP archive."""
    try:
        archive = zipfile.ZipFile(BytesIO(body))
    except zipfile.BadZipFile:
        return None

    best_member: tuple[str, str, int] | None = None
    for member in archive.infolist():
        if member.is_dir():
            continue
        member_name = member.filename
        if not member_name.lower().endswith((".csv", ".tsv", ".psv", ".txt", ".dat")):
            continue
        try:
            text = _decode_structured_text(archive.read(member))
        except (KeyError, RuntimeError, zipfile.BadZipFile):
            continue
        if not _looks_like_delimited_text(text):
            continue
        line_count = len([line for line in text.splitlines() if line.strip()])
        if best_member is None or line_count > best_member[2]:
            best_member = (member_name, text, line_count)

    if best_member is None:
        return None

    member_name, text, _line_count = best_member
    return _structured_page(
        url=url,
        title=member_name.rsplit("/", maxsplit=1)[-1],
        text=text,
        resource_format="zip",
        extra_structured_data={"archive_member": member_name},
    )


def _structured_page(
    *,
    url: str,
    title: str,
    text: str,
    resource_format: str,
    extra_structured_data: dict[str, Any] | None = None,
) -> ContentExtraction:
    """Build a PageContent wrapper for a structured resource."""
    structured_data = {"resource_format": resource_format}
    if extra_structured_data:
        structured_data.update(extra_structured_data)
    return ContentExtraction(
        page=PageContent(
            url=url,
            text=text,
            title=title,
            source_type=_infer_source_type(url, structured_data),
            structured_data=structured_data,
        ),
        reason=None,
        discovered_links=[],
    )


def _decode_structured_text(body: bytes) -> str:
    """Decode structured response bytes with common public-data encodings."""
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return body.decode(encoding)
        except UnicodeDecodeError:
            continue
    return body.decode("utf-8", errors="replace")


def _looks_like_delimited_text(text: str) -> bool:
    """Return whether text appears to contain a row-oriented delimited table."""
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return False
    sample = lines[: min(len(lines), 5)]
    for delimiter in (",", "\t", "|"):
        column_counts = [len(line.split(delimiter)) for line in sample]
        if max(column_counts) >= 3 and sum(count >= 3 for count in column_counts) >= 1:
            return True
    return False


def _resource_title(url: str) -> str:
    """Return the final path component for a structured URL."""
    path = unquote(urlparse(url).path.rstrip("/"))
    return path.rsplit("/", maxsplit=1)[-1] or url


def _resource_format_for_url(url: str, content_type: str) -> str:
    """Return a compact structured format label."""
    path = urlparse(url).path.lower()
    if path.endswith(".tsv") or content_type == "text/tab-separated-values":
        return "tsv"
    if path.endswith(".psv"):
        return "psv"
    return "csv"


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
