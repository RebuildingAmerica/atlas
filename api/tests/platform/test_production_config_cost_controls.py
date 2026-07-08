"""Production configuration cost control tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

from atlas.platform.config import Settings

if TYPE_CHECKING:
    from _pytest.monkeypatch import MonkeyPatch


class TestDiscoveryCostControls:
    """Cost-ceiling and kill-switch settings that bound discovery spend."""

    def test_cost_controls_have_safe_defaults(self) -> None:
        """The cost ceilings default to bounded values with the kill switch off."""
        settings = Settings(database_url="sqlite:///tmp/test.db")

        assert settings.discovery_max_run_cost == 5.0  # noqa: PLR2004
        assert settings.discovery_max_daily_cost == 50.0  # noqa: PLR2004
        assert settings.discovery_cost_kill_switch is False

    def test_cost_controls_read_environment_overrides(self, monkeypatch: MonkeyPatch) -> None:
        """Operators can tighten the ceilings and flip the kill switch via env vars."""
        monkeypatch.setenv("DISCOVERY_MAX_RUN_COST", "1.25")
        monkeypatch.setenv("DISCOVERY_MAX_DAILY_COST", "9.0")
        monkeypatch.setenv("DISCOVERY_COST_KILL_SWITCH", "true")

        settings = Settings(database_url="sqlite:///tmp/test.db")

        assert settings.discovery_max_run_cost == 1.25  # noqa: PLR2004
        assert settings.discovery_max_daily_cost == 9.0  # noqa: PLR2004
        assert settings.discovery_cost_kill_switch is True
