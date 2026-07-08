"""Shared support for discovery pipeline tests."""

from __future__ import annotations

import importlib
import importlib.util

import pytest

EXPECTED_TWO_RECORDS = 2
EXPECTED_ACCEPTED_STATUS = 202


def load_runner_module() -> object:
    """Load the pipeline runner module or fail with a clear assertion."""
    if importlib.util.find_spec("atlas.domains.discovery.pipeline.runner") is None:
        pytest.fail("atlas.domains.discovery.pipeline.runner module is missing")
    return importlib.import_module("atlas.domains.discovery.pipeline.runner")
