"""HTML extraction helpers with explicit quality reasons and discovered links."""

from __future__ import annotations

import zipfile
from io import BytesIO
from typing import Any
from urllib.parse import unquote, urlparse

import trafilatura
from atlas_discovery_engine.web_content import (
    LOGIN_PATTERNS as LOGIN_PATTERNS,
)
from atlas_discovery_engine.web_content import (
    MIN_WORD_COUNT as MIN_WORD_COUNT,
)
from atlas_discovery_engine.web_content import (
    ContentExtraction as ContentExtraction,
)
from atlas_discovery_engine.web_content import (
    _infer_source_type as _infer_source_type,
)
from atlas_discovery_engine.web_content import (
    _parse_metadata_datetime as _parse_metadata_datetime,
)
from atlas_discovery_engine.web_content import (
    _StructuredDataParser as _StructuredDataParser,
)
from atlas_discovery_engine.web_content import (
    content_quality_reason as content_quality_reason,
)
from atlas_discovery_engine.web_content import (
    extract_html_content,
)
from atlas_discovery_engine.web_content import (
    extract_structured_data as extract_structured_data,
)
from atlas_discovery_engine.web_content import (
    is_quality_content as is_quality_content,
)
from atlas_shared import PageContent


def extract_content(html: str, url: str) -> PageContent | None:
    """Extract clean text content from HTML or return ``None`` on failure."""
    return extract_content_verbose(html, url).page


def extract_content_verbose(html: str, url: str) -> ContentExtraction:
    """Extract page content using the shared source-quality rules."""
    return extract_html_content(
        html,
        url,
        text_reader=lambda body: trafilatura.extract(
            body, include_comments=False, include_tables=True
        ),
        metadata_reader=trafilatura.extract_metadata,
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
