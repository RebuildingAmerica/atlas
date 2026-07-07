"""Article mention extraction helpers for Scout article corpora."""

from __future__ import annotations

import html
import re

__all__ = ["extract_article_mentions", "optional_article_text", "plain_article_text"]

_ARTICLE_MENTION_LIMIT = 50
_ARTICLE_MENTION_CONNECTORS = frozenset({"and", "for", "of", "the", "&"})
_ARTICLE_MENTION_PREFIX_TRIM_WORDS = frozenset(
    {
        "a",
        "an",
        "anyone",
        "after",
        "as",
        "at",
        "audience",
        "before",
        "by",
        "during",
        "for",
        "from",
        "if",
        "in",
        "into",
        "of",
        "on",
        "over",
        "that",
        "the",
        "these",
        "this",
        "those",
        "to",
        "under",
        "when",
        "while",
        "with",
        "without",
    }
)
_ARTICLE_MENTION_SUFFIX_TRIM_WORDS = _ARTICLE_MENTION_CONNECTORS | frozenset(
    {"do", "does", "don't", "dont", "for", "from", "in", "of", "on", "the", "to", "with"}
)
_ARTICLE_MENTION_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "after",
        "amid",
        "also",
        "and",
        "annual",
        "april",
        "as",
        "at",
        "before",
        "by",
        "christmas",
        "city",
        "current",
        "december",
        "development",
        "during",
        "everyone",
        "exclusive",
        "february",
        "five",
        "fresh",
        "for",
        "fortunately",
        "friday",
        "from",
        "food",
        "goals",
        "he",
        "her",
        "here",
        "hers",
        "him",
        "his",
        "how",
        "hundreds",
        "i",
        "i'm",
        "i've",
        "in",
        "interview",
        "industry",
        "into",
        "it",
        "it's",
        "january",
        "july",
        "june",
        "just",
        "knife",
        "latest",
        "letter",
        "letters",
        "live",
        "look",
        "looking",
        "march",
        "may",
        "monday",
        "more",
        "most",
        "new",
        "news",
        "next",
        "now",
        "november",
        "october",
        "on",
        "older",
        "ouch",
        "over",
        "people",
        "police",
        "radio",
        "renovating",
        "response",
        "saturday",
        "september",
        "she",
        "since",
        "spat",
        "staff",
        "sunday",
        "that",
        "the",
        "their",
        "there",
        "these",
        "they",
        "this",
        "those",
        "thursday",
        "today",
        "to",
        "tuesday",
        "under",
        "virtual",
        "watching",
        "wednesday",
        "we",
        "well",
        "what",
        "when",
        "while",
        "with",
        "world",
        "you",
        "you're",
        "you\u2019re",
    }
)
_ARTICLE_MENTION_PATTERN = re.compile(
    r"\b(?:[A-Z]{2,}|[A-Z][A-Za-z0-9]*(?:['\u2019][A-Za-z0-9]+)?"
    r"(?:-[A-Z][A-Za-z0-9]*(?:['\u2019][A-Za-z0-9]+)?)*)(?:\s+"
    r"(?:and|for|of|the|&|[A-Z]{2,}|[A-Z][A-Za-z0-9]*(?:['\u2019][A-Za-z0-9]+)?"
    r"(?:-[A-Z][A-Za-z0-9]*(?:['\u2019][A-Za-z0-9]+)?)*)){0,5}\b"
)
_ARTICLE_MENTION_EDGE_CHARS = " \t\n\r'\"\u201c\u201d\u2018\u2019.,:;!?()[]{}"


def extract_article_mentions(
    *,
    title: str,
    trail_text: str,
    body_text: str,
) -> list[dict[str, str]]:
    """Extract conservative text-derived mention candidates from article copy."""
    seen: set[str] = set()
    mentions: list[dict[str, str]] = []
    for source, text in (
        ("headline", title),
        ("trail_text", trail_text),
        ("body_text", body_text),
    ):
        for match in _ARTICLE_MENTION_PATTERN.finditer(text):
            for mention_name in _article_mention_variants(match.group(0)):
                if not _is_meaningful_article_mention(mention_name):
                    continue
                key = mention_name.casefold()
                if key in seen:
                    continue
                seen.add(key)
                mentions.append({"name": mention_name, "type": "text", "source": source})
                if len(mentions) >= _ARTICLE_MENTION_LIMIT:
                    return mentions
    return mentions


def _article_mention_variants(value: str) -> list[str]:
    """Return mention candidates from a regex match without merging actor pairs."""
    cleaned = _clean_article_mention(value)
    if not cleaned:
        return []
    split_parts = [_clean_article_mention(part) for part in re.split(r"\s+and\s+", cleaned)]
    if len(split_parts) == 2 and all(
        _article_mention_content_token_count(part) >= 2 for part in split_parts
    ):
        return split_parts
    return [cleaned]


def plain_article_text(value: object) -> str:
    """Return plain text from a Guardian text field."""
    if not isinstance(value, str):
        return ""
    without_markup = re.sub(r"<[^>]+>", " ", html.unescape(value))
    return re.sub(r"\s+", " ", without_markup).strip()


def optional_article_text(value: object) -> str:
    """Return a stripped string for optional metadata fields."""
    return value.strip() if isinstance(value, str) else ""


def _clean_article_mention(value: str) -> str:
    """Normalize punctuation around a text-derived mention candidate."""
    cleaned = re.sub(r"\s+", " ", value).strip(_ARTICLE_MENTION_EDGE_CHARS)
    cleaned = re.sub(r"(?:'s|\u2019s)$", "", cleaned).strip()
    tokens = cleaned.split()
    while tokens and _article_mention_token_key(tokens[0]) in _ARTICLE_MENTION_PREFIX_TRIM_WORDS:
        tokens.pop(0)
    while tokens and _article_mention_token_key(tokens[-1]) in _ARTICLE_MENTION_SUFFIX_TRIM_WORDS:
        tokens.pop()
    return " ".join(tokens).strip(_ARTICLE_MENTION_EDGE_CHARS)


def _is_meaningful_article_mention(value: str) -> bool:
    """Return whether a candidate looks like an entity mention."""
    if not value:
        return False
    tokens = value.split()
    content_tokens = [
        token.strip(_ARTICLE_MENTION_EDGE_CHARS)
        for token in tokens
        if token.casefold() not in _ARTICLE_MENTION_CONNECTORS
    ]
    if not content_tokens:
        return False
    if all(token.casefold() in _ARTICLE_MENTION_STOPWORDS for token in content_tokens):
        return False
    if len(content_tokens) == 1:
        token = content_tokens[0]
        if token.casefold() in _ARTICLE_MENTION_STOPWORDS or len(token) < 3:
            return False
        return token.isupper() or len(token) >= 4
    return any(token[:1].isupper() or token.isupper() for token in content_tokens)


def _article_mention_token_key(value: str) -> str:
    """Return a normalized key for mention token filtering."""
    return value.strip(_ARTICLE_MENTION_EDGE_CHARS).casefold()


def _article_mention_content_token_count(value: str) -> int:
    """Return non-connector token count for a mention candidate."""
    return sum(
        1
        for token in value.split()
        if token.strip(_ARTICLE_MENTION_EDGE_CHARS).casefold() not in _ARTICLE_MENTION_CONNECTORS
    )
