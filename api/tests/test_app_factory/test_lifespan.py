"""Tests for app startup, shutdown, and worker lifecycle."""

from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING
from unittest.mock import MagicMock, patch

import httpx
import pytest

if TYPE_CHECKING:
    from collections.abc import Callable

from atlas.main import create_app, lifespan
from atlas.platform.config import Settings, get_settings


class TestLifespan:
    """Startup and shutdown behavior."""

    @pytest.mark.asyncio
    async def test_lifespan_initializes_database(self, db_url: str) -> None:
        """The lifespan should call init_db on startup."""
        settings = Settings(
            database_url=db_url,
            deploy_mode="local",
        )

        app = create_app()
        app.dependency_overrides[get_settings] = lambda: settings

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/health")
            assert response.status_code == HTTPStatus.OK

    @pytest.mark.asyncio
    async def test_lifespan_propagates_init_db_failure(self) -> None:
        """A failing database bootstrap should bubble up."""
        settings = Settings(
            database_url="sqlite:///atlas_test.db",
            deploy_mode="local",
        )

        async def failing_init_db(_url: str, **_kwargs: object) -> None:
            raise RuntimeError("init")

        mock_app = MagicMock()

        with (
            patch("atlas.main.get_settings", return_value=settings),
            patch("atlas.main.init_db", new=failing_init_db),
            pytest.raises(RuntimeError, match="init"),
        ):
            async with lifespan(mock_app):
                pass


class TestLifespanWorker:
    """Worker startup and shutdown behavior."""

    @pytest.mark.asyncio
    async def test_lifespan_starts_and_stops_job_worker(
        self,
        db_url: str,
        monkeypatch: pytest.MonkeyPatch,
        patch_mcp_session_manager: Callable[[], None],
    ) -> None:
        """A clean lifespan should start and stop the durable worker."""
        patch_mcp_session_manager()
        settings = Settings(
            database_url=db_url,
            deploy_mode="local",
        )

        started: list[dict[str, object]] = []
        stopped: list[bool] = []

        async def fake_start(database_url: str, **kwargs: object) -> None:
            started.append({"database_url": database_url, **kwargs})

        async def fake_stop() -> None:
            stopped.append(True)

        monkeypatch.setattr("atlas.domains.discovery.worker.start_job_worker", fake_start)
        monkeypatch.setattr("atlas.domains.discovery.worker.stop_job_worker", fake_stop)

        mock_app = MagicMock()
        with patch("atlas.main.get_settings", return_value=settings):
            async with lifespan(mock_app):
                assert started, "expected start_job_worker to have been invoked"
        assert stopped == [True]

    @pytest.mark.asyncio
    async def test_lifespan_skips_job_worker_when_disabled(
        self,
        db_url: str,
        monkeypatch: pytest.MonkeyPatch,
        patch_mcp_session_manager: Callable[[], None],
    ) -> None:
        """When disabled, the API should not launch the durable worker."""
        patch_mcp_session_manager()
        settings = Settings(
            database_url=db_url,
            deploy_mode="local",
            discovery_job_worker_enabled=False,
        )

        started: list[dict[str, object]] = []
        stopped: list[bool] = []

        async def fake_start(database_url: str, **kwargs: object) -> None:
            started.append({"database_url": database_url, **kwargs})

        async def fake_stop() -> None:
            stopped.append(True)

        monkeypatch.setattr("atlas.domains.discovery.worker.start_job_worker", fake_start)
        monkeypatch.setattr("atlas.domains.discovery.worker.stop_job_worker", fake_stop)

        mock_app = MagicMock()
        with patch("atlas.main.get_settings", return_value=settings):
            async with lifespan(mock_app):
                pass

        assert started == []
        assert stopped == []
