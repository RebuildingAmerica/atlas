"""Tests for the Rich-backed Scout CLI output helpers."""

from __future__ import annotations

import io

from atlas_shared import (
    DeduplicatedEntry,
    EntityType,
    GapReport,
    GeoSpecificity,
    RankedEntry,
)
from rich.console import Console
from rich.text import Text

from atlas_scout.cli_output import (
    print_duplicate_run_notice,
    print_run_banner,
    print_run_results,
    styled_status,
)
from atlas_scout.config import ScoutConfig
from atlas_scout.pipeline import PipelineResult
from atlas_scout.runtime import build_runtime_profile


def _captured_console() -> tuple[Console, io.StringIO]:
    buffer = io.StringIO()
    return Console(file=buffer, width=120, color_system=None, record=False), buffer


# ---------------------------------------------------------------------------
# styled_status
# ---------------------------------------------------------------------------


def test_styled_status_known_status_uses_colour() -> None:
    text = styled_status("completed")
    assert isinstance(text, Text)
    assert text.style == "green"


def test_styled_status_unknown_status_falls_back_to_blank_style() -> None:
    text = styled_status("never-seen-before")
    assert text.style == ""


# ---------------------------------------------------------------------------
# print_run_banner
# ---------------------------------------------------------------------------


def test_print_run_banner_renders_full_metadata() -> None:
    console, buffer = _captured_console()
    config = ScoutConfig()
    profile = build_runtime_profile(config)

    print_run_banner(
        console,
        config=config,
        profile=profile,
        refresh=True,
        directive="Find legal aid groups",
        location="Austin, TX",
        url_count=5,
    )

    output = buffer.getvalue()
    assert "Model:" in output
    assert "Cache:" in output
    assert "refresh" in output
    assert "Find legal aid groups" in output
    assert "Austin, TX" in output
    assert "URLs:" in output


def test_print_run_banner_omits_optional_lines_when_empty() -> None:
    console, buffer = _captured_console()
    config = ScoutConfig()
    profile = build_runtime_profile(config)

    print_run_banner(
        console,
        config=config,
        profile=profile,
        refresh=False,
        directive=None,
        location=None,
        url_count=0,
    )

    output = buffer.getvalue()
    assert "Cache:" in output
    assert "reuse" in output
    assert "Focus:" not in output
    assert "Location:" not in output
    assert "URLs:" not in output


# ---------------------------------------------------------------------------
# print_duplicate_run_notice
# ---------------------------------------------------------------------------


def test_print_duplicate_run_notice_shows_run_id() -> None:
    console, buffer = _captured_console()

    print_duplicate_run_notice(console, "run-abc123")

    output = buffer.getvalue()
    assert "run-abc123" in output
    assert "Active run already exists" in output


# ---------------------------------------------------------------------------
# print_run_results
# ---------------------------------------------------------------------------


def _make_ranked_entry(name: str, score: float = 0.9) -> RankedEntry:
    entry = DeduplicatedEntry(
        name=name,
        entry_type=EntityType.ORGANIZATION,
        description="A community group.",
        city="Austin",
        state="TX",
        geo_specificity=GeoSpecificity.LOCAL,
        issue_areas=["housing_affordability"],
    )
    return RankedEntry(entry=entry, score=score, components={})


def test_print_run_results_renders_outcomes_and_table() -> None:
    console, buffer = _captured_console()
    page_outcomes: list[dict[str, object]] = [
        {
            "url": "https://example.com/a",
            "status": "extracted",
            "entries": 3,
            "user_visible": True,
            "error": None,
        },
        {
            "url": "https://example.com/b",
            "status": "fetch_failed",
            "entries": 0,
            "user_visible": True,
            "error": "timeout",
        },
        {
            "url": "https://example.com/c",
            "status": "filtered",
            "entries": 0,
            "user_visible": True,
            "error": None,
        },
    ]
    result = PipelineResult(
        run_id="run-xyz",
        queries_generated=2,
        pages_fetched=3,
        entries_found=3,
        entries_after_dedup=3,
        ranked_entries=[_make_ranked_entry("Org A"), _make_ranked_entry("Org B", score=0.7)],
        gap_report=GapReport(location="Austin, TX", total_entries=3),
        page_outcomes=page_outcomes,
    )

    print_run_results(console, result)

    output = buffer.getvalue()
    assert "Run ID:" in output
    assert "run-xyz" in output
    assert "https://example.com/a" in output
    assert "3 entries" in output
    assert "timeout" in output
    assert "Discovered Entries" in output
    assert "Org A" in output


def test_print_run_results_reports_no_entities_when_ranked_empty() -> None:
    console, buffer = _captured_console()
    result = PipelineResult(
        run_id="run-empty",
        queries_generated=1,
        pages_fetched=0,
        entries_found=0,
        entries_after_dedup=0,
        ranked_entries=[],
        gap_report=GapReport(location="Austin, TX", total_entries=0),
        page_outcomes=[],
    )

    print_run_results(console, result)

    output = buffer.getvalue()
    assert "No entities discovered" in output


def test_print_run_results_handles_missing_city_state() -> None:
    console, buffer = _captured_console()
    entry = DeduplicatedEntry(
        name="Anon Org",
        entry_type=EntityType.ORGANIZATION,
        description="No location",
        city=None,
        state=None,
        geo_specificity=GeoSpecificity.LOCAL,
        issue_areas=["housing_affordability"],
    )
    ranked = RankedEntry(entry=entry, score=0.5, components={})

    result = PipelineResult(
        run_id="run-anon",
        queries_generated=0,
        pages_fetched=0,
        entries_found=1,
        entries_after_dedup=1,
        ranked_entries=[ranked],
        gap_report=GapReport(location="Austin, TX", total_entries=1),
        page_outcomes=[],
    )

    print_run_results(console, result)

    output = buffer.getvalue()
    assert "Anon Org" in output
    assert "?, ?" in output
