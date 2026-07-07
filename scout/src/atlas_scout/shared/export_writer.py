"""Generic json/jsonl/csv row-writer shared by entry and article export commands."""

from __future__ import annotations

import csv
import json
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable


def write_export_rows(
    rows: list[dict[str, Any]],
    output_format: str,
    handle: Any,
    *,
    csv_fields: list[str],
    csv_row: Callable[[dict[str, Any]], dict[str, str]],
) -> None:
    """Write rows to a text handle as json, jsonl, or csv."""
    if output_format == "json":
        json.dump(rows, handle, indent=2)
        handle.write("\n")
        return

    if output_format == "jsonl":
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True))
            handle.write("\n")
        return

    writer = csv.DictWriter(handle, fieldnames=csv_fields)
    writer.writeheader()
    for row in rows:
        writer.writerow(csv_row(row))
