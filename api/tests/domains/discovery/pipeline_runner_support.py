"""Shared helpers for discovery pipeline runner tests."""

from __future__ import annotations

import importlib
import importlib.util

import pytest

SEARCH_OFFLINE_ERROR = "search offline"
STRENGTHENED_SOURCE_COUNT = 2


def _load_runner_module() -> object:
    """Load the pipeline runner module or fail with a clear assertion."""
    if importlib.util.find_spec("atlas.domains.discovery.pipeline.runner") is None:
        pytest.fail("atlas.domains.discovery.pipeline.runner module is missing")
    return importlib.import_module("atlas.domains.discovery.pipeline.runner")
