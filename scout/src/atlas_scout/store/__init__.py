"""Local SQLite store for Atlas Scout runs, cache, entries, and daemon state.

ScoutStore is a thin facade over one repository per aggregate, composed
onto a single shared Database connection. The public class stays here so
existing callers can keep importing ``atlas_scout.store.ScoutStore`` while
the method groups live in smaller mixin modules beside the repositories.
"""

from __future__ import annotations

from atlas_scout.store.scout_store_base import ScoutStoreBaseMixin
from atlas_scout.store.scout_store_content import ScoutStoreContentMixin
from atlas_scout.store.scout_store_daemon import ScoutStoreDaemonMixin
from atlas_scout.store.scout_store_ops import ScoutStoreOpsMixin
from atlas_scout.store.scout_store_runs import ScoutStoreRunsMixin

__all__ = ["ScoutStore"]


class ScoutStore(
    ScoutStoreBaseMixin,
    ScoutStoreDaemonMixin,
    ScoutStoreRunsMixin,
    ScoutStoreContentMixin,
    ScoutStoreOpsMixin,
):
    """Async SQLite store for Scout's local state."""

