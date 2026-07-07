"""Entry browsing, export, stats, and purge helpers for Scout.

Public API facade over the entries/ package: shared loading/filtering
(query), stats (stats), purge (purge), browse listing (browse), and export
(export).
"""

from __future__ import annotations

from atlas_scout.entries.browse import _entries_list
from atlas_scout.entries.export import (
    _ENTRY_EXPORT_CSV_FIELDS,
    _entry_export_csv_row,
    _entry_export_row,
    _export_entries,
    _string_list,
    _write_entry_export,
)
from atlas_scout.entries.purge import _print_purge_payload, entries_purge_command
from atlas_scout.entries.query import (
    _dedupe_entries_by_name,
    _entry_score,
    _load_entries,
    _select_entries_for_output,
)
from atlas_scout.entries.stats import _empty_entry_stats, _load_entry_stats, entries_stats_command

__all__ = [
    "_ENTRY_EXPORT_CSV_FIELDS",
    "_dedupe_entries_by_name",
    "_empty_entry_stats",
    "_entries_list",
    "_entry_export_csv_row",
    "_entry_export_row",
    "_entry_score",
    "_export_entries",
    "_load_entries",
    "_load_entry_stats",
    "_print_purge_payload",
    "_select_entries_for_output",
    "_string_list",
    "_write_entry_export",
    "entries_purge_command",
    "entries_stats_command",
]
