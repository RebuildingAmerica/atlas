"""Tests for Atlas MCP elicitation helpers."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from mcp import types

from atlas.platform.mcp.elicitation import (
    CLIENT_CAPABILITIES_META_KEY,
    declares_elicitation_mode,
    declares_form_elicitation,
    declares_url_elicitation,
)
from tests.support.mcp_elicitation import _meta


class TestElicitationCapabilities:
    def test_ignores_missing_or_malformed_metadata(self) -> None:
        assert declares_form_elicitation(None) is False
        assert declares_form_elicitation("not metadata") is False
        assert (
            declares_form_elicitation({CLIENT_CAPABILITIES_META_KEY: "not capabilities"}) is False
        )
        assert declares_form_elicitation(_meta({"elicitation": "not elicitation"})) is False

    def test_accepts_metadata_model_with_model_dump(self) -> None:
        class MetadataModel:
            def model_dump(self, **kwargs: object) -> dict[str, Any]:
                assert kwargs == {"by_alias": True, "exclude_none": True}
                return _meta({"elicitation": {"form": {}}})

        assert declares_form_elicitation(MetadataModel()) is True

    def test_form_mode_requires_elicitation_capability(self) -> None:
        assert declares_form_elicitation(_meta({})) is False

    def test_empty_elicitation_capability_means_form(
        self,
    ) -> None:
        assert declares_form_elicitation(_meta({"elicitation": {}})) is True

    def test_explicit_form_mode_is_supported(self) -> None:
        assert declares_form_elicitation(_meta({"elicitation": {"form": {}}})) is True

    def test_form_flag_disables_support(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "atlas.platform.mcp.elicitation.get_settings",
            lambda: SimpleNamespace(mcp_form_elicitation_enabled=False),
        )

        assert declares_form_elicitation(_meta({"elicitation": {"form": {}}})) is False

    def test_url_mode_requires_explicit_url_capability(self) -> None:
        assert declares_url_elicitation(_meta({"elicitation": {}})) is False
        assert declares_url_elicitation(_meta({"elicitation": {"url": {}}})) is True

    def test_capability_helpers_accept_sdk_model(self) -> None:
        capabilities = types.ClientCapabilities(
            elicitation=types.ElicitationCapability(
                form=types.FormElicitationCapability(),
                url=types.UrlElicitationCapability(),
            )
        )
        assert declares_form_elicitation(_meta(capabilities.model_dump(exclude_none=True))) is True
        assert declares_url_elicitation(_meta(capabilities.model_dump(exclude_none=True))) is True

    def test_mode_helper_rejects_unknown_mode(self) -> None:
        with pytest.raises(ValueError, match="Unsupported elicitation mode"):
            declares_elicitation_mode(_meta({"elicitation": {}}), "modal")  # type: ignore[arg-type]

    def test_mode_helper_dispatches_supported_modes(self) -> None:
        meta = _meta({"elicitation": {"form": {}, "url": {}}})
        assert declares_elicitation_mode(meta, "form") is True
        assert declares_elicitation_mode(meta, "url") is True
