"""Production configuration rollout flag tests."""

from __future__ import annotations

from atlas.platform.config import Settings


class TestMcpElicitationRolloutControls:
    """Operator rollout flags for MCP elicitation phases."""

    def test_elicitation_flags_default_on(self) -> None:
        """The shipped path stays enabled unless operators opt out."""
        settings = Settings(database_url="sqlite:///tmp/test.db")

        assert settings.mcp_form_elicitation_enabled is True
        assert settings.mcp_url_elicitation_enabled is True
        assert settings.mcp_workbench_handoffs_enabled is True

    def test_elicitation_flags_can_disable_phases(self) -> None:
        """Operators can roll back form, URL, and Workbench handoffs independently."""
        settings = Settings(
            database_url="sqlite:///tmp/test.db",
            mcp_form_elicitation_enabled=False,
            mcp_url_elicitation_enabled=False,
            mcp_workbench_handoffs_enabled=False,
        )

        assert settings.mcp_form_elicitation_enabled is False
        assert settings.mcp_url_elicitation_enabled is False
        assert settings.mcp_workbench_handoffs_enabled is False
