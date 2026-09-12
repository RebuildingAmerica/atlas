"""Database manager and the migrations applied to an existing database.

Two unrelated jobs live here. ``additive_columns`` adds columns to tables a
deployed database already created, which is the routine case. The ``atproto_*``
modules perform the one structural migration Atlas has needed so far, moving
per-entry ATProto columns into a shared identity graph.
"""

from __future__ import annotations

from .additive_columns import (
    _ensure_discovery_job_columns,
    _ensure_discovery_run_columns,
    _ensure_entry_columns,
    _ensure_org_annotation_columns,
    _ensure_org_coverage_target_columns,
    _ensure_place_context_columns,
    _ensure_place_related_place_columns,
    _ensure_review_queue_columns,
)
from .atproto_ddl import _ATPROTO_GRAPH_POSTGRES_DDL, _ATPROTO_GRAPH_SQLITE_DDL
from .atproto_graph import migrate_atproto_identity_graph
from .atproto_reconcile import _migration_id
from .manager import DatabaseManager, db

__all__ = [
    "_ATPROTO_GRAPH_POSTGRES_DDL",
    "_ATPROTO_GRAPH_SQLITE_DDL",
    "DatabaseManager",
    "_ensure_discovery_job_columns",
    "_ensure_discovery_run_columns",
    "_ensure_entry_columns",
    "_ensure_org_annotation_columns",
    "_ensure_org_coverage_target_columns",
    "_ensure_place_context_columns",
    "_ensure_place_related_place_columns",
    "_ensure_review_queue_columns",
    "_migration_id",
    "db",
    "migrate_atproto_identity_graph",
]
