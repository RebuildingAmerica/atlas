"""Normalization and validation helpers for extraction responses."""

from __future__ import annotations

import logging
from difflib import SequenceMatcher

from atlas_shared import PageContent, RawEntry

logger = logging.getLogger(__name__)

_GEO_ALIASES: dict[str, str] = {
    "local": "local",
    "city": "local",
    "city-level": "local",
    "neighborhood": "local",
    "targeted": "local",
    "regional": "regional",
    "county": "regional",
    "metro": "regional",
    "district": "regional",
    "statewide": "statewide",
    "state": "statewide",
    "state-level": "statewide",
    "national": "national",
    "federal": "national",
    "nationwide": "national",
}

_TYPE_ALIASES: dict[str, str] = {
    "person": "person",
    "individual": "person",
    "people": "person",
    "organization": "organization",
    "org": "organization",
    "nonprofit": "organization",
    "ngo": "organization",
    "initiative": "initiative",
    "program": "initiative",
    "project": "initiative",
    "campaign": "campaign",
    "movement": "campaign",
    "event": "event",
    "conference": "event",
    "rally": "event",
}

_NAME_SIMILARITY_THRESHOLD = 0.75
_CONTEXT_SIMILARITY_THRESHOLD = 0.6
_MIN_CONTEXT_LENGTH = 10


def normalize_geo_specificity(value: str) -> str:
    """Normalize LLM geo_specificity output to a valid enum value."""
    normalized = value.lower().strip()
    result = _GEO_ALIASES.get(normalized)
    if result is None:
        logger.warning("Unknown geo_specificity %r from LLM — defaulting to 'local'", value)
        return "local"
    return result


def normalize_entity_type(value: str) -> str:
    """Normalize LLM entity type output to a valid enum value."""
    normalized = value.lower().strip()
    result = _TYPE_ALIASES.get(normalized)
    if result is None:
        logger.warning("Unknown entity type %r from LLM — defaulting to 'organization'", value)
        return "organization"
    return result


def validate_entries(
    entries: list[RawEntry],
    page: PageContent,
) -> list[RawEntry]:
    """Validate extracted entries against the source text."""
    if not entries:
        return entries

    source_lower = page.text.lower()
    validated: list[RawEntry] = []

    for entry in entries:
        if not _has_proper_noun_signal(entry.name):
            logger.info(
                "Dropping entry %r — no proper-noun signal (all lowercase common words)",
                entry.name,
            )
            continue

        name_grounded = _name_is_grounded(entry.name, source_lower)
        context_grounded = _context_is_grounded(entry.extraction_context, source_lower)

        if not name_grounded and not context_grounded:
            logger.info(
                "Dropping hallucinated entry %r — name and context not found in source text",
                entry.name,
            )
            continue

        validated.append(entry)

    dropped = len(entries) - len(validated)
    if dropped:
        logger.info(
            "Validation dropped %d/%d entries from %s",
            dropped,
            len(entries),
            page.url,
        )

    return validated


def _has_proper_noun_signal(name: str) -> bool:
    """Check if a name looks like a real entity (proper noun or acronym)."""
    words = name.strip().split()
    if not words:
        return False

    if name.strip().isupper() and len(name.strip()) >= 2:
        return True

    for word in words[1:]:
        if word[0].isupper():
            return True
        if word.isupper() and len(word) >= 2:
            return True

    if len(words) == 1:
        return words[0][0].isupper()

    return words[0][0].isupper()


def _name_is_grounded(name: str, source_lower: str) -> bool:
    """Check if the entity name appears in the source text."""
    name_lower = name.lower().strip()
    if not name_lower:
        return False

    if name_lower in source_lower:
        return True

    words = [w for w in name_lower.split() if len(w) >= 3]
    if not words:
        return False
    found = sum(1 for w in words if w in source_lower)
    if len(words) >= 2 and found / len(words) >= 0.7:
        return True

    if len(name_lower) >= 5:
        best_ratio = _best_substring_similarity(
            name_lower,
            source_lower,
            early_exit=_NAME_SIMILARITY_THRESHOLD,
        )
        if best_ratio >= _NAME_SIMILARITY_THRESHOLD:
            return True

    return False


def _context_is_grounded(context: str, source_lower: str) -> bool:
    """Check if the extraction context is a real substring of the source text."""
    if not context or len(context.strip()) < _MIN_CONTEXT_LENGTH:
        return False

    context_lower = context.lower().strip()

    if context_lower in source_lower:
        return True

    best_ratio = _best_substring_similarity(
        context_lower,
        source_lower,
        early_exit=_CONTEXT_SIMILARITY_THRESHOLD,
    )
    return best_ratio >= _CONTEXT_SIMILARITY_THRESHOLD


def _best_substring_similarity(needle: str, haystack: str, *, early_exit: float = 1.0) -> float:
    """Find the best fuzzy match ratio for needle anywhere in haystack."""
    if not needle or not haystack:
        return 0.0

    needle_len = len(needle)
    if needle_len > len(haystack):
        return SequenceMatcher(None, needle, haystack).ratio()

    best = 0.0
    step = max(1, needle_len // 4)
    for i in range(0, len(haystack) - needle_len + 1, step):
        window = haystack[i : i + needle_len + needle_len // 3]
        ratio = SequenceMatcher(None, needle, window).ratio()
        if ratio > best:
            best = ratio
            if best >= early_exit:
                return best

    return best
