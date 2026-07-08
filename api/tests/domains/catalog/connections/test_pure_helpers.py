"""Tests for the side-effect-free connection helpers."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, cast

from atlas.domains.catalog.models.connections import _pluralize, _snippet, _tier_for_strength


class TestPureHelpers:
    def test_tier_for_strength_boundaries(self) -> None:
        assert _tier_for_strength(100) == "strong"
        assert _tier_for_strength(67) == "strong"
        assert _tier_for_strength(66) == "moderate"
        assert _tier_for_strength(34) == "moderate"
        assert _tier_for_strength(33) == "weak"
        assert _tier_for_strength(0) == "weak"

    def test_pluralize(self) -> None:
        assert _pluralize(1, "source") == "1 source"
        assert _pluralize(0, "source") == "0 sources"
        assert _pluralize(3, "issue area") == "3 issue areas"

    def test_snippet(self) -> None:
        assert _snippet(cast("Any", SimpleNamespace(description="hello"))) == "hello"
        assert _snippet(cast("Any", SimpleNamespace(description=""))) is None
        assert _snippet(cast("Any", SimpleNamespace(description="x" * 200))) == "x" * 120
