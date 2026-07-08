"""Public Scout pipeline API."""

from __future__ import annotations

from atlas_scout.pipeline_runtime import (
    _STATUS_INTERVAL_SECONDS,
    _parse_location,
    logger,
    run_pipeline,
)
from atlas_scout.pipeline_state import PipelineResult
from atlas_scout.steps.discovery_engine_adapters import rank_entries_stream
from atlas_scout.steps.gap_analysis import analyze_gaps

__all__ = [
    "_STATUS_INTERVAL_SECONDS",
    "PipelineResult",
    "_parse_location",
    "analyze_gaps",
    "logger",
    "rank_entries_stream",
    "run_pipeline",
]
