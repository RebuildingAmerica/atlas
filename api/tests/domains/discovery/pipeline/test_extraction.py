"""Discovery extraction helper tests."""

from __future__ import annotations

import importlib

import pytest
from atlas_discovery_engine import build_extraction_system_prompt, parse_extraction_response

ANTHROPIC_OUTAGE_ERROR = "anthropic outage"
PASS_TWO_OUTAGE_ERROR = "pass2 outage"


class TestExtractionHelpers:
    """Tests for prompt and parsing helpers."""

    def testbuild_extraction_system_prompt_includes_location_and_taxonomy(self) -> None:
        """The extraction prompt should carry the target location and issue taxonomy."""
        prompt = build_extraction_system_prompt("Kansas City", "MO")

        assert "Kansas City, MO" in prompt
        assert "housing_affordability" in prompt
        assert "worker_cooperatives" in prompt

    def testparse_extraction_response_handles_fenced_json(self) -> None:
        """Claude JSON responses wrapped in Markdown fences should still parse."""
        payload = """
```json
[
  {
    "name": "Prairie Workers Cooperative",
    "type": "organization",
    "description": "Worker-owned cooperative.",
    "city": "Kansas City",
    "state": "MO",
    "geo_specificity": "local",
    "issue_areas": ["worker_cooperatives"],
    "website": "https://prairie.example",
    "email": "info@prairie.example",
    "extraction_context": "The cooperative now employs 45 people."
  }
]
```
"""
        parsed = parse_extraction_response(text=payload)

        assert len(parsed) == 1
        assert parsed[0].name == "Prairie Workers Cooperative"
        assert parsed[0].website == "https://prairie.example"
        assert parsed[0].email == "info@prairie.example"

    def testparse_extraction_response_accepts_object_wrapper(self) -> None:
        """Object-wrapped payloads should parse via the entries field."""
        payload = """
        {
          "entries": [
            {
              "name": "Wrapped Entry",
              "type": "organization",
              "description": "Wrapped.",
              "city": "Kansas City",
              "state": "MO",
              "geo_specificity": "local",
              "issue_areas": ["housing_affordability"]
            }
          ]
        }
        """
        parsed = parse_extraction_response(text=payload)

        assert len(parsed) == 1
        assert parsed[0].name == "Wrapped Entry"

    @pytest.mark.asyncio
    async def test_extract_entries_calls_anthropic_and_parses_text_blocks(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Extraction should call Anthropic with two passes and parse the returned JSON."""
        call_count = 0
        pass1_response = (
            '[{"name":"Kansas City Housing Coalition","type":"organization",'
            '"quote":"The Kansas City Housing Coalition works on affordability."}]'
        )
        pass2_response = (
            '{"entries":[{"name":"Kansas City Housing Coalition","type":"organization",'
            '"description":"Parsed from Claude.","city":"Kansas City",'
            '"state":"MO","geo_specificity":"local",'
            '"issue_areas":["housing_affordability"],'
            '"extraction_context":"The Kansas City Housing Coalition works on affordability."}],'
            '"discovery_leads":[]}'
        )

        class FakeMessages:
            async def create(self, **_kwargs: object) -> object:
                nonlocal call_count
                call_count += 1
                text = pass1_response if call_count == 1 else pass2_response
                return type(
                    "Response",
                    (),
                    {"content": [type("Block", (), {"type": "text", "text": text})()]},
                )()

        class FakeAnthropic:
            def __init__(self, **_kwargs: object) -> None:
                self.messages = FakeMessages()

        monkeypatch.setattr(
            "atlas.domains.discovery.pipeline.extractor.AsyncAnthropic", FakeAnthropic
        )

        parsed = await importlib.import_module(
            "atlas.domains.discovery.pipeline.extractor"
        ).extract_entries(
            "https://example.com/story",
            "The Kansas City Housing Coalition works on affordability in Kansas City.",
            "Kansas City",
            "MO",
            "test-key",
        )

        assert len(parsed) == 1
        assert parsed[0].name == "Kansas City Housing Coalition"

    @pytest.mark.asyncio
    async def test_extract_entries_returns_empty_without_api_key(self) -> None:
        """Missing Anthropic credentials should short-circuit before calling the API."""
        extractor = importlib.import_module("atlas.domains.discovery.pipeline.extractor")
        result = await extractor.extract_entries(
            "https://example.com/story",
            "Substantive content about civic actors.",
            "Kansas City",
            "MO",
            api_key=None,
        )
        assert result == []

    @pytest.mark.asyncio
    async def test_extract_entries_returns_empty_for_blank_content(self) -> None:
        """Empty source text should short-circuit before calling the API."""
        extractor = importlib.import_module("atlas.domains.discovery.pipeline.extractor")
        result = await extractor.extract_entries(
            "https://example.com/story",
            "   ",
            "Kansas City",
            "MO",
            api_key="test-key",
        )
        assert result == []

    @pytest.mark.asyncio
    async def test_extract_entries_returns_empty_when_pass_one_identifies_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """If pass 1 returns no entities, pass 2 should not run and the result is empty."""
        extractor = importlib.import_module("atlas.domains.discovery.pipeline.extractor")

        class FakeMessages:
            def __init__(self) -> None:
                self.calls = 0

            async def create(self, **_kwargs: object) -> object:
                self.calls += 1
                return type(
                    "Response",
                    (),
                    {"content": [type("Block", (), {"type": "text", "text": "[]"})()]},
                )()

        fake_messages = FakeMessages()

        class FakeAnthropic:
            def __init__(self, **_kwargs: object) -> None:
                self.messages = fake_messages

        monkeypatch.setattr(
            "atlas.domains.discovery.pipeline.extractor.AsyncAnthropic", FakeAnthropic
        )

        result = await extractor.extract_entries(
            "https://example.com/story",
            "Substantive content about civic actors.",
            "Kansas City",
            "MO",
            "test-key",
        )
        assert result == []
        assert fake_messages.calls == 1

    @pytest.mark.asyncio
    async def test_extract_entries_returns_empty_when_pass_one_keeps_failing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Repeated pass-1 errors should exhaust retries and yield an empty result."""
        extractor = importlib.import_module("atlas.domains.discovery.pipeline.extractor")

        class FakeMessages:
            def __init__(self) -> None:
                self.calls = 0

            async def create(self, **_kwargs: object) -> object:
                self.calls += 1
                raise RuntimeError(ANTHROPIC_OUTAGE_ERROR)

        fake_messages = FakeMessages()

        class FakeAnthropic:
            def __init__(self, **_kwargs: object) -> None:
                self.messages = fake_messages

        monkeypatch.setattr(
            "atlas.domains.discovery.pipeline.extractor.AsyncAnthropic", FakeAnthropic
        )

        result = await extractor.extract_entries(
            "https://example.com/story",
            "Substantive content about civic actors.",
            "Kansas City",
            "MO",
            "test-key",
        )
        assert result == []
        assert fake_messages.calls == 3  # noqa: PLR2004

    @pytest.mark.asyncio
    async def test_extract_entries_returns_empty_when_pass_two_keeps_failing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """If pass 2 raises every attempt, extraction should return an empty list."""
        extractor = importlib.import_module("atlas.domains.discovery.pipeline.extractor")
        pass1_response = (
            '[{"name":"Kansas City Housing Coalition","type":"organization",'
            '"quote":"The Kansas City Housing Coalition works on affordability."}]'
        )

        class FakeMessages:
            def __init__(self) -> None:
                self.calls = 0

            async def create(self, **_kwargs: object) -> object:
                self.calls += 1
                if self.calls == 1:
                    return type(
                        "Response",
                        (),
                        {
                            "content": [
                                type("Block", (), {"type": "text", "text": pass1_response})()
                            ]
                        },
                    )()
                raise RuntimeError(PASS_TWO_OUTAGE_ERROR)

        fake_messages = FakeMessages()

        class FakeAnthropic:
            def __init__(self, **_kwargs: object) -> None:
                self.messages = fake_messages

        monkeypatch.setattr(
            "atlas.domains.discovery.pipeline.extractor.AsyncAnthropic", FakeAnthropic
        )

        result = await extractor.extract_entries(
            "https://example.com/story",
            "Substantive content about civic actors.",
            "Kansas City",
            "MO",
            "test-key",
        )
        assert result == []
        assert fake_messages.calls == 4  # noqa: PLR2004
