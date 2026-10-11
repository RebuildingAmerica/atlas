"""Ordinary API startup must not allocate discovery's classifier tables."""

import subprocess
import sys


def test_registry_routes_can_load_without_allocating_name_classifier() -> None:
    """An unavailable classifier cannot prevent browsing unrelated API routes."""
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; "
            "sys.modules['probablepeople'] = None; "
            "from atlas.domains.discovery.resolution.register_mentions import display_name; "
            "assert display_name('SARAH STONE') == 'Sarah Stone'",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
