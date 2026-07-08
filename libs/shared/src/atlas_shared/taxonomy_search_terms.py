"""Search-term taxonomy for the Atlas ecosystem."""

from __future__ import annotations

from atlas_shared.taxonomy_search_terms_core import (
    ISSUE_SEARCH_TERMS as ISSUE_SEARCH_TERMS_CORE,
)
from atlas_shared.taxonomy_search_terms_extended import (
    ISSUE_SEARCH_TERMS as ISSUE_SEARCH_TERMS_EXTENDED,
)

__all__ = ["ISSUE_SEARCH_TERMS"]

ISSUE_SEARCH_TERMS: dict[str, list[str]] = {}
ISSUE_SEARCH_TERMS.update(ISSUE_SEARCH_TERMS_CORE)
ISSUE_SEARCH_TERMS.update(ISSUE_SEARCH_TERMS_EXTENDED)
