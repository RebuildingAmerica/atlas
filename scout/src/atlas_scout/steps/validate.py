"""
Post-extraction validation to catch hallucinated entities.

Runs programmatic checks on LLM-extracted entries to verify they are
grounded in the source text. Entries that fail validation are dropped
with a logged reason.
"""

from __future__ import annotations

import logging
from difflib import SequenceMatcher

from atlas_shared import PageContent, RawEntry

logger = logging.getLogger(__name__)

__all__ = ["validate_entries"]

# Thresholds
_NAME_SIMILARITY_THRESHOLD = 0.75
_CONTEXT_SIMILARITY_THRESHOLD = 0.6
_MIN_CONTEXT_LENGTH = 10


def validate_entries(
    entries: list[RawEntry],
    page: PageContent,
) -> list[RawEntry]:
    """Validate extracted entries against the source text.

    Drops entries that appear to be hallucinated based on:
    1. Entity name has no proper-noun signal (no capitalized words, no acronyms)
    2. Entity name not found in source text
    3. Extraction context not found in source text
    """
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

        if not name_grounded:
            logger.debug(
                "Entry %r: name not found verbatim in source but context is grounded",
                entry.name,
            )

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
    """Check if a name looks like a real entity (proper noun or acronym).

    Real entity names have at least one of:
    - A word starting with an uppercase letter (after the first word)
    - An all-caps word (acronym: ACLU, ICE, NAACP)
    - A word with mixed case (iPhone, McCormick)

    Generic/structural names like "title", "content", "publication date"
    are all-lowercase common words and fail this check.
    """
    words = name.strip().split()
    if not words:
        return False

    # All-caps names are always proper (acronyms)
    if name.strip().isupper() and len(name.strip()) >= 2:
        return True

    # Check words beyond the first (first word is always capitalized in a sentence)
    for word in words[1:]:
        if word[0].isupper():
            return True
        if word.isupper() and len(word) >= 2:
            return True

    # Single-word names: must be capitalized or all-caps
    if len(words) == 1:
        return words[0][0].isupper()

    # Multi-word, all lowercase = generic ("publication date", "content summary")
    # But first word capitalized + rest lowercase could be a name ("Mozilla foundation")
    # Accept if the first word is capitalized
    return words[0][0].isupper()


def _name_is_grounded(name: str, source_lower: str) -> bool:
    """Check if the entity name appears in the source text.

    Uses exact substring match first, then fuzzy matching to handle
    minor differences (e.g., "VOYCE" vs "Voices of Youth in Chicago Education (VOYCE)").
    """
    name_lower = name.lower().strip()
    if not name_lower:
        return False

    # Exact substring
    if name_lower in source_lower:
        return True

    # Check individual significant words (3+ chars) — if most appear, name is grounded
    words = [w for w in name_lower.split() if len(w) >= 3]
    if not words:
        return False
    found = sum(1 for w in words if w in source_lower)
    if len(words) >= 2 and found / len(words) >= 0.7:
        return True

    # Fuzzy: find best matching window in source
    if len(name_lower) >= 5:
        best_ratio = _best_substring_similarity(name_lower, source_lower, early_exit=_NAME_SIMILARITY_THRESHOLD)
        if best_ratio >= _NAME_SIMILARITY_THRESHOLD:
            return True

    return False


def _context_is_grounded(context: str, source_lower: str) -> bool:
    """Check if the extraction context is a real substring of the source text."""
    if not context or len(context.strip()) < _MIN_CONTEXT_LENGTH:
        return False

    context_lower = context.lower().strip()

    # Exact substring
    if context_lower in source_lower:
        return True

    # Fuzzy match — LLMs sometimes slightly misquote
    best_ratio = _best_substring_similarity(context_lower, source_lower, early_exit=_CONTEXT_SIMILARITY_THRESHOLD)
    return best_ratio >= _CONTEXT_SIMILARITY_THRESHOLD


def _best_substring_similarity(needle: str, haystack: str, *, early_exit: float = 1.0) -> float:
    """Find the best fuzzy match ratio for needle anywhere in haystack.

    Slides a window of needle's length across haystack and returns the
    best SequenceMatcher ratio found. Limited to reasonable window sizes
    to avoid O(n*m) blowup on very long texts.
    """
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
