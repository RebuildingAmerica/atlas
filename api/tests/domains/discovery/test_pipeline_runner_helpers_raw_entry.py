"""Runner helper tests for raw-entry conversion."""

from __future__ import annotations

from atlas_shared import PageContent, SourceType

from tests.domains.discovery.pipeline_runner_support import _load_runner_module


class TestRunnerHelpersRawEntry:
    """Runner helper tests for raw-entry conversion and task outcome parsing."""

    def test_build_page_task_outcomes_skips_entries_without_source_urls(self) -> None:
        """Raw entries lacking a list-shaped source_urls field should be skipped cleanly."""
        runner_module = _load_runner_module()
        sources = [
            PageContent(
                url="https://example.com/page-a",
                source_type=SourceType.NEWS_ARTICLE,
            )
        ]
        outcomes = runner_module._build_page_task_outcomes(  # noqa: SLF001
            sources,
            raw_entries=[
                {"name": "no source urls"},
                {"name": "wrong shape", "source_urls": "not-a-list"},
                {"name": "good", "source_urls": ["https://example.com/page-a"]},
            ],
        )
        assert len(outcomes) == 1
        assert outcomes[0].entries_extracted == 1

    def test_raw_entry_to_shared_handles_missing_source_metadata(self) -> None:
        """Raw entries with no source dates / contexts should still convert cleanly."""
        runner_module = _load_runner_module()
        shared = runner_module._raw_entry_to_shared(  # noqa: SLF001
            {
                "name": "Bare Entry",
                "entry_type": "organization",
                "description": "No source metadata at all.",
                "city": "Kansas City",
                "state": "MO",
                "geo_specificity": "local",
                "issue_areas": ["housing_affordability"],
            }
        )
        assert shared.name == "Bare Entry"
        assert shared.source_url == ""
        assert shared.source_date is None
        assert shared.extraction_context == ""

    def test_raw_entry_to_shared_skips_extraction_context_for_non_dict_payload(self) -> None:
        """A non-dict source_contexts value should not contribute an extraction_context."""
        runner_module = _load_runner_module()
        shared = runner_module._raw_entry_to_shared(  # noqa: SLF001
            {
                "name": "Quirky Entry",
                "entry_type": "organization",
                "description": "Has a URL but malformed contexts.",
                "city": "Kansas City",
                "state": "MO",
                "geo_specificity": "local",
                "issue_areas": ["housing_affordability"],
                "source_urls": ["https://example.com/story"],
                "source_contexts": "should-have-been-a-dict",
            }
        )
        assert shared.source_url == "https://example.com/story"
        assert shared.extraction_context == ""
