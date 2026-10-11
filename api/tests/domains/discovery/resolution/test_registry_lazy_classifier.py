"""Ordinary API startup must not allocate discovery's classifier tables."""

import subprocess
import sys

import pytest


@pytest.mark.parametrize(
    ("dependency", "operation"),
    [
        (
            "probablepeople",
            "from atlas.domains.discovery.resolution.register_mentions import display_name; "
            "assert display_name('SARAH STONE') == 'Sarah Stone'",
        ),
        (
            "trafilatura",
            "from atlas.domains.discovery.pipeline.source_fetcher import build_search_provider; "
            "assert build_search_provider(None) is None",
        ),
    ],
)
def test_registry_routes_can_load_without_discovery_models(dependency: str, operation: str) -> None:
    """Unavailable extraction models cannot block unrelated API operations."""
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            f"import sys; sys.modules[{dependency!r}] = None; {operation}",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
