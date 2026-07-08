"""Tests for the pipeline result dataclass."""

from atlas_shared import GapReport

from atlas_scout.pipeline import PipelineResult


def test_pipeline_result_fields():
    gap_report = GapReport(location="Test, TX", total_entries=0)
    result = PipelineResult(
        run_id="abc123",
        queries_generated=10,
        pages_fetched=5,
        entries_found=3,
        entries_after_dedup=2,
        ranked_entries=[],
        gap_report=gap_report,
    )
    assert result.run_id == "abc123"
    assert result.queries_generated == 10
    assert result.entries_found == 3
