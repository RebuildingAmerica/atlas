"""Configuration models for Atlas Scout."""

from __future__ import annotations

import tomllib
from pathlib import Path

from pydantic import BaseModel, Field


class LLMConfig(BaseModel):
    provider: str = "ollama"
    model: str = "llama3.1:8b"
    base_url: str | None = None
    max_concurrent: int = 10


class ScraperConfig(BaseModel):
    max_concurrent_fetches: int = 20
    page_cache_ttl_days: int = 7
    follow_links: bool = True
    max_link_depth: int = 2
    max_pages_per_seed: int = 20
    request_delay_ms: int = 200


class PipelineConfig(BaseModel):
    dedup_batch_size: int = 50
    min_entry_score: float = 0.3
    gap_analysis: bool = True
    iterative_deepening: bool = False


class ScheduleTarget(BaseModel):
    location: str
    issues: list[str] = Field(default_factory=list)
    search_depth: str = "standard"


class ScheduleConfig(BaseModel):
    enabled: bool = False
    cron: str = "0 2 * * *"
    max_concurrent_runs: int = 2
    targets: list[ScheduleTarget] = Field(default_factory=list)


class ContributionConfig(BaseModel):
    enabled: bool = False
    api_key: str = ""
    atlas_url: str = "https://atlas.rebuilding.us"
    min_score: float = 0.7


class StoreConfig(BaseModel):
    path: str = "~/.atlas-scout/scout.db"


class ScoutConfig(BaseModel):
    llm: LLMConfig = Field(default_factory=LLMConfig)
    scraper: ScraperConfig = Field(default_factory=ScraperConfig)
    pipeline: PipelineConfig = Field(default_factory=PipelineConfig)
    schedule: ScheduleConfig = Field(default_factory=ScheduleConfig)
    contribution: ContributionConfig = Field(default_factory=ContributionConfig)
    store: StoreConfig = Field(default_factory=StoreConfig)


def load_config(path: Path) -> ScoutConfig:
    """Load ScoutConfig from a TOML file. Falls back to defaults if file is missing."""
    if not path.exists():
        return ScoutConfig()

    with path.open("rb") as f:
        data = tomllib.load(f)

    return ScoutConfig.model_validate(data)
