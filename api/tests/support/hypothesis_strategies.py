"""Reusable Hypothesis strategies for Atlas tests."""

from collections.abc import Sequence

from hypothesis import strategies as st
from hypothesis.strategies import DrawFn, SearchStrategy, composite

from atlas.domains.catalog.taxonomy import ALL_ISSUE_SLUGS
from atlas.platform.mcp.data import _STATE_NAMES

_ISSUE_AREA_SLUGS: Sequence[str] = tuple(sorted(ALL_ISSUE_SLUGS))
_STATE_ABBREVIATIONS: Sequence[str] = tuple(sorted(set(_STATE_NAMES.values())))


def issue_area_slugs() -> SearchStrategy[str]:
    """Generate valid Atlas issue area identifiers."""
    return st.sampled_from(_ISSUE_AREA_SLUGS)


def state_abbreviations() -> SearchStrategy[str]:
    """Generate valid two-letter state abbreviations used in place keys."""
    return st.sampled_from(_STATE_ABBREVIATIONS)


def city_names() -> SearchStrategy[str]:
    """Generate title-cased city names with one to three words."""
    word = st.text(
        alphabet=st.characters(min_codepoint=ord("a"), max_codepoint=ord("z")),
        min_size=2,
        max_size=10,
    )
    return st.lists(word, min_size=1, max_size=3).map(
        lambda words: " ".join(part.capitalize() for part in words)
    )


@composite
def city_state_place_keys(draw: DrawFn) -> tuple[str, str, str]:
    """Generate normalized Atlas place keys plus their expected city/state outputs."""
    city = draw(city_names())
    state = draw(state_abbreviations())
    place_key = f"{city.lower().replace(' ', '-')}-{state.lower()}"
    return place_key, city, state
