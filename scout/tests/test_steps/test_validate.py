"""Tests for atlas_scout.steps.validate."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas_shared import PageContent, RawEntry

if TYPE_CHECKING:
    import pytest

from atlas_scout.steps.validate import (
    _best_substring_similarity,
    _context_is_grounded,
    _has_proper_noun_signal,
    _name_is_grounded,
    validate_entries,
)


def _entry(
    *,
    name: str = "Housing First",
    context: str = "Housing First helps renters in Austin.",
) -> RawEntry:
    return RawEntry(
        name=name,
        entry_type="organization",
        description="Some description",
        city="Austin",
        state="TX",
        geo_specificity="local",
        issue_areas=[],
        affiliated_org=None,
        website=None,
        email=None,
        social_media={},
        extraction_context=context,
        mentioned_entities=[],
    )


def _page(text: str = "") -> PageContent:
    return PageContent(url="https://example.com", text=text, title="")


def test_validate_entries_with_no_entries_returns_empty() -> None:
    """Empty input returns the same empty list."""
    assert validate_entries([], _page("anything")) == []


def test_validate_drops_entries_without_proper_noun_signal(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Generic lowercase names like 'publication date' are dropped."""
    entry = _entry(name="publication date", context="some context that is long enough")
    page = _page("publication date appears here verbatim plus filler text" * 3)

    with caplog.at_level("INFO", logger="atlas_scout.steps.validate"):
        out = validate_entries([entry], page)

    assert out == []
    assert any("no proper-noun signal" in r.message for r in caplog.records)


def test_validate_keeps_entries_with_grounded_name() -> None:
    """A name found verbatim in the source is kept."""
    entry = _entry(name="Housing First", context="something else entirely 1234567890")
    page = _page("Housing First is an organization in Austin TX." * 3)

    out = validate_entries([entry], page)

    assert len(out) == 1
    assert out[0].name == "Housing First"


def test_validate_drops_entry_when_neither_name_nor_context_grounded(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Entries with no name match and no context match are logged and dropped."""
    entry = _entry(name="Phantom Org", context="never said this anywhere")
    page = _page("Completely unrelated text about kittens and rainbows.")

    with caplog.at_level("INFO", logger="atlas_scout.steps.validate"):
        out = validate_entries([entry], page)

    assert out == []
    assert any("hallucinated entry" in r.message for r in caplog.records)
    assert any("Validation dropped" in r.message for r in caplog.records)


def test_validate_keeps_entry_when_only_context_is_grounded(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Entry kept and debug-logged when name missing but context grounded."""
    entry = _entry(name="Zzz Foundation", context="exact phrase appears here verbatim")
    page = _page("This article notes that exact phrase appears here verbatim somewhere.")

    with caplog.at_level("DEBUG", logger="atlas_scout.steps.validate"):
        out = validate_entries([entry], page)

    assert len(out) == 1


def test_has_proper_noun_signal_blank_returns_false() -> None:
    """Whitespace-only names have no proper-noun signal."""
    assert _has_proper_noun_signal("   ") is False


def test_has_proper_noun_signal_all_caps_acronym() -> None:
    """All-caps short tokens count as acronyms."""
    assert _has_proper_noun_signal("ACLU") is True


def test_has_proper_noun_signal_first_word_capitalized() -> None:
    """A capitalized first word in a single-word name is accepted."""
    assert _has_proper_noun_signal("Mozilla") is True


def test_has_proper_noun_signal_single_lowercase_rejected() -> None:
    """A single lowercase word is rejected."""
    assert _has_proper_noun_signal("housing") is False


def test_has_proper_noun_signal_multi_lowercase_rejected() -> None:
    """All-lowercase multi-word names are rejected."""
    assert _has_proper_noun_signal("publication date") is False


def test_has_proper_noun_signal_capitalized_followup_word() -> None:
    """A non-first word starting with uppercase is a signal."""
    assert _has_proper_noun_signal("the Brookings Institution") is True


def test_has_proper_noun_signal_acronym_followup_word() -> None:
    """A non-first all-caps token (>=2 chars) is a signal."""
    assert _has_proper_noun_signal("the ACLU") is True


def test_has_proper_noun_signal_digit_prefix_acronym_followup() -> None:
    """A non-first token starting with a digit but otherwise all-caps is a signal."""
    # "9HZ" - first char is digit so word[0].isupper() is False, but word.isupper() is True
    assert _has_proper_noun_signal("the 9HZ") is True


def test_has_proper_noun_signal_first_word_capitalized_multi() -> None:
    """Multi-word names with first word capitalized accepted."""
    assert _has_proper_noun_signal("Mozilla foundation") is True


def test_name_is_grounded_blank() -> None:
    """A blank name is not grounded."""
    assert _name_is_grounded("   ", "anything") is False


def test_name_is_grounded_exact_substring() -> None:
    """An exact substring match counts as grounded."""
    assert _name_is_grounded("Housing First", "we love housing first today") is True


def test_name_is_grounded_word_overlap_threshold() -> None:
    """If 70%+ of significant words appear in source, name is grounded."""
    # Two of two significant words ("tenants", "renters") found in source = 100%.
    # Source must NOT contain the full phrase (otherwise exact match wins).
    source = "advocates for tenants and renters every day, full of activity"
    assert _name_is_grounded("Tenants Renters", source) is True


def test_name_is_grounded_single_significant_word_misses() -> None:
    """Names with only short words (<3 chars) and no exact match miss."""
    assert _name_is_grounded("a b", "totally unrelated text") is False


def test_name_is_grounded_fuzzy_match_succeeds() -> None:
    """Slight typos still ground via fuzzy matching."""
    source = "the housing first initiative was started in 2020 and continues today"
    assert _name_is_grounded("Housing Frist", source) is True


def test_name_is_grounded_completely_different_returns_false() -> None:
    """A name with nothing in common returns False."""
    assert _name_is_grounded("Quantum Engineers", "kittens love rainbows in summer") is False


def test_name_is_grounded_short_name_skips_fuzzy() -> None:
    """Short names (<5 chars) skip fuzzy matching when not directly grounded."""
    # name "abc" - len < 5, no exact match, words = ["abc"] (single word, len<2 so fails 70% rule branch)
    assert _name_is_grounded("abc", "totally unrelated body of text") is False


def test_context_is_grounded_too_short() -> None:
    """Very short contexts are rejected outright."""
    assert _context_is_grounded("hi", "long source text body") is False


def test_context_is_grounded_empty() -> None:
    """Empty context returns False."""
    assert _context_is_grounded("", "anything") is False


def test_context_is_grounded_exact() -> None:
    """An exact substring match is grounded."""
    assert _context_is_grounded(
        "Housing First helps renters",
        "the housing first helps renters group is active",
    ) is True


def test_context_is_grounded_fuzzy_succeeds() -> None:
    """A near-quote is grounded by fuzzy matching."""
    source = "the housing first organization helps renters in austin every day"
    assert _context_is_grounded("Housing First organisation helps renters", source) is True


def test_context_is_grounded_completely_different_returns_false() -> None:
    """Wholly different text below threshold is not grounded."""
    assert _context_is_grounded(
        "this exact quote does not appear",
        "kittens and puppies live in a magical land far from here",
    ) is False


def test_best_substring_similarity_empty_inputs() -> None:
    """Empty needle or haystack returns 0.0."""
    assert _best_substring_similarity("", "abc") == 0.0
    assert _best_substring_similarity("abc", "") == 0.0


def test_best_substring_similarity_needle_longer_than_haystack() -> None:
    """When needle exceeds haystack, falls back to whole-string ratio."""
    ratio = _best_substring_similarity("a very long needle string", "short")
    assert 0.0 <= ratio <= 1.0


def test_best_substring_similarity_early_exit() -> None:
    """When ratio meets early_exit threshold the loop bails out."""
    ratio = _best_substring_similarity("abcdef", "xx abcdef yy", early_exit=0.5)
    assert ratio >= 0.5
