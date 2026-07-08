"""Shared helpers for scheduler loop tests."""

from __future__ import annotations

from types import SimpleNamespace

from atlas_scout.config import ScoutConfig
from atlas_scout.runtime import RuntimeProfile


def make_config(tmp_path, *, cron: str | None = None) -> ScoutConfig:
    config: dict[str, object] = {
        "store": {"path": str(tmp_path / "scout.db")},
        "schedule": {
            "targets": [
                {
                    "location": "Austin, TX",
                    "issues": ["housing_affordability"],
                    "search_depth": "standard",
                }
            ]
        },
    }
    if cron is not None:
        config["schedule"] = {
            "cron": cron,
            "targets": config["schedule"]["targets"],
        }
    return ScoutConfig.model_validate(config)


def runtime_profile(_: object = None) -> RuntimeProfile:
    return RuntimeProfile(
        cpu_count=8,
        total_memory_bytes=16 * 1024 * 1024 * 1024,
        max_memory_percent=70,
        max_total_workers=64,
        search_concurrency=7,
        fetch_concurrency=11,
        extract_concurrency=2,
        url_frontier_queue_size=500,
        fetched_page_queue_size=100,
    )


class FakeProvider:
    async def close(self) -> None:
        return None


class FakeFetcher:
    def __init__(self, **_: object) -> None:
        return None

    async def close(self) -> None:
        return None


class FakeStore:
    def __init__(self, path: str, *, on_tick=None, on_start=None, on_heartbeat=None, on_stop=None):
        self.path = path
        self._on_tick = on_tick
        self._on_start = on_start
        self._on_heartbeat = on_heartbeat
        self._on_stop = on_stop

    async def initialize(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def start_daemon(self, **kwargs: object) -> None:
        if self._on_start is not None:
            self._on_start(kwargs)

    async def record_daemon_heartbeat(self, **kwargs: object) -> None:
        if self._on_heartbeat is not None:
            self._on_heartbeat(kwargs)

    async def record_daemon_tick_result(self, **kwargs: object) -> None:
        if self._on_tick is not None:
            self._on_tick(kwargs)

    async def stop_daemon(self, **kwargs: object) -> None:
        if self._on_stop is not None:
            self._on_stop(kwargs)


def make_store_factory(**callbacks):
    def factory(path: str) -> FakeStore:
        return FakeStore(path, **callbacks)

    return factory


def make_success_result() -> SimpleNamespace:
    return SimpleNamespace(run_id="run-123", entries_found=4, entries_after_dedup=3)
