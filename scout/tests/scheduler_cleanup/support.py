"""Shared helpers for scheduler cleanup tests."""

from __future__ import annotations

from types import SimpleNamespace

from atlas_scout.config import ScoutConfig
from atlas_scout.runtime import RuntimeProfile


def build_config(tmp_path) -> ScoutConfig:
    return ScoutConfig.model_validate(
        {
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
    )


def build_runtime_profile() -> RuntimeProfile:
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


class FakeFetcher:
    def __init__(self, **_: object) -> None:
        return None

    async def close(self) -> None:
        return None


class FakeStore:
    def __init__(self, path: str, *, close_error: str | None = None) -> None:
        self.path = path
        self._close_error = close_error

    async def initialize(self) -> None:
        return None

    async def close(self) -> None:
        if self._close_error is not None:
            raise RuntimeError(self._close_error)


class FakeProvider:
    def __init__(self, *, close_error: str | None = None) -> None:
        self._close_error = close_error

    async def close(self) -> None:
        if self._close_error is not None:
            raise RuntimeError(self._close_error)


def make_run_result(run_id: str, entries_found: int = 0, entries_after_dedup: int = 0) -> SimpleNamespace:
    return SimpleNamespace(
        run_id=run_id,
        entries_found=entries_found,
        entries_after_dedup=entries_after_dedup,
    )
