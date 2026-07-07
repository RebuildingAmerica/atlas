"""Shared entry loading and filtering used by browse and export."""

from __future__ import annotations

import random
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig


async def _load_entries(
    config: ScoutConfig,
    *,
    min_score: float,
    run_ids: tuple[str, ...],
) -> list[dict[str, Any]]:
    """Load local entries for review or export."""
    from atlas_scout.store import ScoutStore

    db_path = Path(config.store.path).expanduser()
    if not db_path.exists():
        raise FileNotFoundError(db_path)

    store = ScoutStore(str(db_path))
    await store.initialize()
    try:
        if run_ids:
            entries: list[dict[str, Any]] = []
            for run_id in run_ids:
                entries.extend(await store.list_entries(run_id=run_id, min_score=min_score))
            return entries
        return await store.list_entries(min_score=min_score)
    finally:
        await store.close()


def _select_entries_for_output(
    entries: list[dict[str, Any]],
    *,
    limit: int,
    random_sample: bool,
    unlimited_when_zero: bool,
) -> list[dict[str, Any]]:
    """Apply output limits and optional random sampling."""
    normalized_limit = max(0, limit)
    if unlimited_when_zero and normalized_limit == 0:
        normalized_limit = len(entries)
    if random_sample:
        return random.sample(entries, min(normalized_limit, len(entries)))
    return entries[:normalized_limit]


def _dedupe_entries_by_name(entries: list[dict[str, object]]) -> list[dict[str, object]]:
    """Return one entry per normalized name/type/location, preferring higher scores."""
    best_by_key: dict[tuple[str, str, str, str], dict[str, object]] = {}
    ordered_keys: list[tuple[str, str, str, str]] = []
    for entry in entries:
        key = (
            str(entry.get("name", "")).strip().casefold(),
            str(entry.get("entry_type", "")).strip().casefold(),
            str(entry.get("city") or "").strip().casefold(),
            str(entry.get("state") or "").strip().casefold(),
        )
        if key[0] == "":
            continue
        existing = best_by_key.get(key)
        if existing is None:
            ordered_keys.append(key)
            best_by_key[key] = entry
            continue
        if _entry_score(entry) > _entry_score(existing):
            best_by_key[key] = entry
    return [best_by_key[key] for key in ordered_keys]


def _entry_score(entry: dict[str, object]) -> float:
    """Return an entry score as a sortable float."""
    score = entry.get("score", 0.0)
    return float(score) if isinstance(score, (int, float)) else 0.0
