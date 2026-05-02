"""Tests for the user-facing progress renderer."""

from __future__ import annotations

import io
from typing import TYPE_CHECKING

from rich.console import Console

from atlas_scout import cli_progress
from atlas_scout.cli_progress import ProgressRenderer, filter_visible_page_outcomes

if TYPE_CHECKING:
    import pytest


def _captured_console() -> tuple[Console, io.StringIO]:
    buffer = io.StringIO()
    return Console(file=buffer, width=120, color_system=None, record=False), buffer


# ---------------------------------------------------------------------------
# filter_visible_page_outcomes
# ---------------------------------------------------------------------------


def test_filter_visible_page_outcomes_returns_only_visible_when_some_visible() -> None:
    page_outcomes: list[dict[str, object]] = [
        {"url": "https://a", "user_visible": False},
        {"url": "https://b", "user_visible": True},
    ]
    assert filter_visible_page_outcomes(page_outcomes) == [page_outcomes[1]]


def test_filter_visible_page_outcomes_returns_empty_list_when_all_invisible() -> None:
    page_outcomes: list[dict[str, object]] = [
        {"url": "https://a", "user_visible": False},
    ]
    assert filter_visible_page_outcomes(page_outcomes) == []


def test_filter_visible_page_outcomes_returns_all_when_visibility_not_tracked() -> None:
    page_outcomes: list[dict[str, object]] = [
        {"url": "https://a", "status": "extracted"},
    ]
    assert filter_visible_page_outcomes(page_outcomes) == page_outcomes


# ---------------------------------------------------------------------------
# ProgressRenderer.emit — quiet mode
# ---------------------------------------------------------------------------


def test_progress_renderer_quiet_emits_nothing() -> None:
    console, buffer = _captured_console()
    renderer = ProgressRenderer(console=console, quiet=True)

    renderer.emit("page_found", {"url": "https://example.com/a", "depth": 0})

    assert buffer.getvalue() == ""


# ---------------------------------------------------------------------------
# ProgressRenderer.emit — user mode
# ---------------------------------------------------------------------------


def test_progress_renderer_user_event_renders_known_label() -> None:
    console, buffer = _captured_console()
    renderer = ProgressRenderer(console=console)

    renderer.emit(
        "page_found",
        {
            "url": "https://example.com/a",
            "depth": 1,
            "name": "Test Org",
            "entry_type": "organization",
            "links_found": 3,
            "links_queued": 1,
        },
    )

    output = buffer.getvalue()
    assert "PAGE_FOUND" in output
    assert "depth=1" in output
    assert "name=Test Org" in output
    assert "type=organization" in output
    assert "links_found=3" in output
    assert "links_queued=1" in output
    assert "url=https://example.com/a" in output


def test_progress_renderer_user_event_skips_unknown_event() -> None:
    console, buffer = _captured_console()
    renderer = ProgressRenderer(console=console)

    renderer.emit("never_heard_of_it", {"url": "https://example.com/x"})

    assert buffer.getvalue() == ""


# ---------------------------------------------------------------------------
# ProgressRenderer.emit — verbose mode (event labels and active tracking)
# ---------------------------------------------------------------------------


def test_progress_renderer_verbose_renders_known_event_with_fields() -> None:
    console, buffer = _captured_console()
    renderer = ProgressRenderer(console=console, verbose=True)

    renderer.emit(
        "fetch_completed",
        {
            "url": "https://example.com/a",
            "depth": 0,
            "task_id": "t1",
            "attempt": 2,
            "reason": "ok",
            "entries": 5,
            "discovered_links": 4,
            "queued_links": 2,
            "name": "Org",
        },
    )

    output = buffer.getvalue()
    assert "FETCH_COMPLETED" in output
    assert "attempt=2" in output
    assert "entries=5" in output
    assert "links_found=4" in output
    assert "links_queued=2" in output


def test_progress_renderer_verbose_uses_uppercase_default_for_unknown_event() -> None:
    console, buffer = _captured_console()
    renderer = ProgressRenderer(console=console, verbose=True)

    renderer.emit("custom_event", {"url": "https://example.com/x"})

    output = buffer.getvalue()
    assert "CUSTOM_EVENT" in output


def test_progress_renderer_verbose_tracks_active_fetches_then_clears_on_completion() -> None:
    console, buffer = _captured_console()
    renderer = ProgressRenderer(console=console, verbose=True)

    renderer.emit("fetch_started", {"task_id": "abc", "url": "https://example.com/a"})
    assert "abc" in renderer.active_fetches

    renderer.emit("fetch_completed", {"task_id": "abc", "url": "https://example.com/a"})
    assert "abc" not in renderer.active_fetches

    assert "FETCH_STARTED" in buffer.getvalue()


def test_progress_renderer_verbose_tracks_active_extracts_then_clears_on_completion() -> None:
    console, _buffer = _captured_console()
    renderer = ProgressRenderer(console=console, verbose=True)

    renderer.emit("extract_started", {"task_id": "ext-1", "url": "https://example.com/p"})
    assert "ext-1" in renderer.active_extracts

    renderer.emit("extract_failed", {"task_id": "ext-1", "url": "https://example.com/p"})
    assert "ext-1" not in renderer.active_extracts


# ---------------------------------------------------------------------------
# ProgressRenderer.emit — verbose status throttling
# ---------------------------------------------------------------------------


def test_progress_renderer_verbose_status_skipped_when_no_active_work(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_now = [200.0]

    def fake_perf_counter() -> float:
        return fake_now[0]

    monkeypatch.setattr(cli_progress.time, "perf_counter", fake_perf_counter)

    console, buffer = _captured_console()
    # Construct renderer with started_at well in the past, so the quiet window
    # is already cleared and the only thing that suppresses output is "no active work".
    renderer = ProgressRenderer(console=console, verbose=True, started_at=100.0)

    renderer.emit(
        "status",
        {
            "fetch_active": 0,
            "extract_active": 0,
            "frontier_queued": 0,
            "extract_queued": 0,
            "entries_found": 0,
        },
    )

    assert buffer.getvalue() == ""


def test_progress_renderer_verbose_status_skipped_within_quiet_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_now = [100.0]

    def fake_perf_counter() -> float:
        return fake_now[0]

    monkeypatch.setattr(cli_progress.time, "perf_counter", fake_perf_counter)

    console, buffer = _captured_console()
    renderer = ProgressRenderer(console=console, verbose=True)

    # Same instant as initialization → within the quiet window → skipped.
    renderer.emit(
        "status",
        {
            "fetch_active": 1,
            "extract_active": 0,
            "frontier_queued": 2,
            "extract_queued": 0,
            "entries_found": 0,
        },
    )
    assert buffer.getvalue() == ""


def test_progress_renderer_verbose_status_emits_oldest_work_age(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_now = [100.0]

    def fake_perf_counter() -> float:
        return fake_now[0]

    monkeypatch.setattr(cli_progress.time, "perf_counter", fake_perf_counter)

    console, buffer = _captured_console()
    renderer = ProgressRenderer(console=console, verbose=True, started_at=100.0)

    fake_now[0] = 105.0
    renderer.emit("fetch_started", {"task_id": "f1", "url": "https://example.com/slow"})
    fake_now[0] = 106.0
    renderer.emit("extract_started", {"task_id": "e1", "url": "https://example.com/extract"})

    fake_now[0] = 200.0  # past the 5s quiet window
    renderer.emit(
        "status",
        {
            "fetch_active": 1,
            "extract_active": 1,
            "frontier_queued": 0,
            "extract_queued": 0,
            "entries_found": 0,
        },
    )

    output = buffer.getvalue()
    assert "WORK_RECORDED" in output
    assert "fetch_active=1" in output
    assert "extract_active=1" in output
    assert "oldest_fetch_age=" in output
    assert "oldest_fetch_url=https://example.com/slow" in output
    assert "oldest_extract_age=" in output
    assert "oldest_extract_url=https://example.com/extract" in output


def test_progress_renderer_verbose_status_skips_url_field_when_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_now = [100.0]

    def fake_perf_counter() -> float:
        return fake_now[0]

    monkeypatch.setattr(cli_progress.time, "perf_counter", fake_perf_counter)

    console, buffer = _captured_console()
    renderer = ProgressRenderer(console=console, verbose=True, started_at=100.0)

    fake_now[0] = 105.0
    # Active work with empty URL — fetch_started without "url" key
    renderer.emit("fetch_started", {"task_id": "no-url"})
    renderer.emit("extract_started", {"task_id": "no-url-ext"})

    fake_now[0] = 200.0
    renderer.emit(
        "status",
        {
            "fetch_active": 1,
            "extract_active": 1,
            "frontier_queued": 0,
            "extract_queued": 0,
            "entries_found": 0,
        },
    )

    output = buffer.getvalue()
    assert "oldest_fetch_age=" in output
    assert "oldest_fetch_url" not in output
    assert "oldest_extract_age=" in output
    assert "oldest_extract_url" not in output


# ---------------------------------------------------------------------------
# Internal helpers — _event_key fallbacks (exercised via verbose tracking)
# ---------------------------------------------------------------------------


def test_progress_renderer_falls_back_to_url_when_task_id_missing() -> None:
    console, _buffer = _captured_console()
    renderer = ProgressRenderer(console=console, verbose=True)

    renderer.emit("fetch_started", {"url": "https://example.com/a"})
    assert "https://example.com/a" in renderer.active_fetches


def test_progress_renderer_no_event_key_does_not_track() -> None:
    console, buffer = _captured_console()
    renderer = ProgressRenderer(console=console, verbose=True)

    renderer.emit("fetch_started", {})
    assert renderer.active_fetches == {}
    assert "FETCH_STARTED" in buffer.getvalue()


def test_progress_renderer_status_with_empty_tracking_dicts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Status reports with positive activity but no tracked items skip oldest fields."""
    fake_now = [200.0]

    def fake_perf_counter() -> float:
        return fake_now[0]

    monkeypatch.setattr(cli_progress.time, "perf_counter", fake_perf_counter)

    console, buffer = _captured_console()
    renderer = ProgressRenderer(console=console, verbose=True, started_at=100.0)

    renderer.emit(
        "status",
        {
            "fetch_active": 1,
            "extract_active": 1,
            "frontier_queued": 0,
            "extract_queued": 0,
            "entries_found": 0,
        },
    )

    output = buffer.getvalue()
    assert "WORK_RECORDED" in output
    assert "oldest_fetch" not in output
    assert "oldest_extract" not in output


def test_progress_renderer_user_event_skips_blank_fields() -> None:
    """User events with None/empty values omit those fields from output."""
    console, buffer = _captured_console()
    renderer = ProgressRenderer(console=console)

    renderer.emit(
        "page_found",
        {
            "url": "",
            "depth": None,
            "name": "",
        },
    )

    output = buffer.getvalue()
    assert "PAGE_FOUND" in output
    assert "depth=" not in output
    assert "name=" not in output
    assert "url=" not in output
