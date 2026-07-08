"""Entry model compatibility barrel."""

from __future__ import annotations

from .entry_listing import EntryListingMixin
from .entry_lookup import EntryLookupMixin
from .entry_model import EntryModel, _row_to_entry, actor_quality, trust_tier
from .entry_mutations import EntryMutationMixin
from .entry_search import EntrySearchMixin

__all__ = ["EntryCRUD", "EntryModel", "_row_to_entry", "actor_quality", "trust_tier"]


class EntryCRUD(EntryLookupMixin, EntryListingMixin, EntryMutationMixin, EntrySearchMixin):
    """CRUD operations for entries."""
