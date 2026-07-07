"""URL discovery helpers for sitemap and feed resources."""

from __future__ import annotations

import gzip
from urllib.parse import urljoin, urlparse
from xml.etree import ElementTree

from atlas_scout.pipeline_support import normalize_url

__all__ = ["extract_discovery_links"]

_DISCOVERY_CONTENT_TYPES = {
    "application/atom+xml",
    "application/rss+xml",
    "application/sitemap+xml",
    "application/xml",
    "text/xml",
}


def extract_discovery_links(body: bytes, *, url: str, content_type: str) -> list[str]:
    """Return article/sitemap candidate URLs from sitemap, RSS, or Atom XML."""
    if _looks_like_robots_resource(url=url):
        text = _decode_discovery_body(body)
        return _normalize_discovery_links(_robots_sitemap_links(text), base_url=url)
    if not _looks_like_discovery_resource(url=url, content_type=content_type, body=body):
        return []
    text = _decode_discovery_body(body)
    if not text.strip():
        return []
    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError:
        return []

    root_name = _local_name(root.tag)
    raw_links: list[str] = []
    if root_name in {"sitemapindex", "urlset"}:
        raw_links.extend(_sitemap_links(root))
    elif root_name in {"rss", "feed"}:
        raw_links.extend(_feed_links(root))
    else:
        return []
    return _normalize_discovery_links(raw_links, base_url=url)


def _looks_like_discovery_resource(*, url: str, content_type: str, body: bytes) -> bool:
    """Return whether a response is worth trying as XML discovery."""
    normalized_content_type = content_type.split(";", maxsplit=1)[0].strip().lower()
    parsed_path = urlparse(url).path.lower()
    if normalized_content_type in _DISCOVERY_CONTENT_TYPES:
        return True
    if parsed_path.endswith((".xml", ".xml.gz", ".rss", ".atom")):
        return True
    stripped = body.lstrip()
    return stripped.startswith((b"<?xml", b"<rss", b"<feed"))


def _looks_like_robots_resource(*, url: str) -> bool:
    """Return whether the URL is a robots.txt discovery resource."""
    return urlparse(url).path.lower().endswith("/robots.txt")


def _decode_discovery_body(body: bytes) -> str:
    """Decode sitemap/feed bytes, including common .xml.gz responses."""
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


def _robots_sitemap_links(text: str) -> list[str]:
    """Return Sitemap directive values from a robots.txt body."""
    links: list[str] = []
    for line in text.splitlines():
        directive, separator, value = line.partition(":")
        if not separator or directive.strip().casefold() != "sitemap":
            continue
        link = value.split("#", maxsplit=1)[0].strip()
        if link:
            links.append(link)
    return links


def _sitemap_links(root: ElementTree.Element) -> list[str]:
    """Return loc values from sitemap index or urlset XML in document order."""
    links: list[str] = []
    for element in root.iter():
        if _local_name(element.tag) not in {"sitemap", "url"}:
            continue
        for child in list(element):
            if _local_name(child.tag) == "loc" and child.text:
                links.append(child.text)
                break
    return links


def _feed_links(root: ElementTree.Element) -> list[str]:
    """Return item/entry links from RSS or Atom feeds in document order."""
    links: list[str] = []
    for element in root.iter():
        name = _local_name(element.tag)
        if name not in {"item", "entry"}:
            continue
        links.extend(_feed_item_links(element))
    return links


def _feed_item_links(item: ElementTree.Element) -> list[str]:
    """Return candidate URLs from one RSS item or Atom entry."""
    links: list[str] = []
    for child in list(item):
        name = _local_name(child.tag)
        if name == "link":
            href = child.attrib.get("href")
            if href:
                rel = child.attrib.get("rel", "alternate")
                if rel in {"", "alternate"}:
                    links.append(href)
                continue
            if child.text:
                links.append(child.text)
        elif name == "guid" and child.text:
            permalink = child.attrib.get("isPermaLink", "true").lower()
            if permalink == "true":
                links.append(child.text)
        elif name == "id" and child.text:
            links.append(child.text)
    return links


def _normalize_discovery_links(raw_links: list[str], *, base_url: str) -> list[str]:
    """Return absolute, deduplicated HTTP URLs from raw feed/sitemap values."""
    seen: set[str] = set()
    links: list[str] = []
    for raw_link in raw_links:
        raw_link = raw_link.strip()
        if not raw_link:
            continue
        absolute = urljoin(base_url, raw_link)
        parsed = urlparse(absolute)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            continue
        normalized = normalize_url(parsed._replace(fragment="").geturl())
        if normalized in seen:
            continue
        seen.add(normalized)
        links.append(normalized)
    return links


def _local_name(tag: str) -> str:
    """Return an XML tag local name without namespace."""
    return tag.rsplit("}", maxsplit=1)[-1].lower()
