"""Pydantic schema for Scout's profile configuration."""

from __future__ import annotations

from pydantic import BaseModel, Field

from atlas_scout.config.paths import DEFAULT_DB_PATH

SECRET_CONFIG_FIELD_NAMES = frozenset({"api_key", "token", "secret", "credential"})


class LLMConfig(BaseModel):
    """Configuration for the LLM provider (model selection and concurrency)."""

    provider: str = "ollama"
    model: str = "llama3.1:8b"
    base_url: str | None = None
    ollama_base_url: str | None = None
    lmstudio_base_url: str | None = None
    api_key: str | None = None
    max_concurrent: int = 10
    timeout_seconds: float = 120.0

    def configured_base_url(self, provider: str) -> str | None:
        """Return a configured endpoint for a local provider, including legacy fallback."""
        normalized = provider.strip().lower()
        if normalized == "ollama":
            return self.ollama_base_url or self._legacy_base_url_for("ollama")
        if normalized == "lmstudio":
            return self.lmstudio_base_url or self._legacy_base_url_for("lmstudio")
        return None

    def set_configured_base_url(self, provider: str, base_url: str | None) -> None:
        """Store an endpoint on the provider-specific field."""
        normalized = provider.strip().lower()
        if normalized == "ollama":
            self.ollama_base_url = base_url
        elif normalized == "lmstudio":
            self.lmstudio_base_url = base_url
        self.base_url = None

    def clear_configured_base_url(self, provider: str) -> None:
        """Clear a provider endpoint and any matching legacy endpoint."""
        self.set_configured_base_url(provider, None)

    def has_configured_base_url(self, provider: str) -> bool:
        """Return whether a local provider has an explicit endpoint configured."""
        return self.configured_base_url(provider) is not None

    def _legacy_base_url_for(self, provider: str) -> str | None:
        if self.provider.strip().lower() == provider:
            return self.base_url
        return None


class ScraperConfig(BaseModel):
    """Configuration for the web scraper (concurrency, depth, and caching)."""

    max_concurrent_searches: int = 0
    max_concurrent_fetches: int = 20
    page_cache_ttl_days: int = 7
    revisit_cached_urls: bool = False
    follow_links: bool = True
    max_link_depth: int = 2
    max_pages_per_seed: int = 20
    request_delay_ms: int = 200
    browser_fallback_enabled: bool = True
    browser_render_timeout_ms: int = 15000
    max_browser_renders_per_run: int = 8
    max_browser_concurrent: int = 1
    search_country: str = ""
    search_freshness: str = ""


class RuntimeConfig(BaseModel):
    """Configuration for adaptive runtime sizing and resource caps."""

    auto_tune: bool = True
    max_memory_percent: int = 70
    max_total_workers: int | None = None


class PipelineConfig(BaseModel):
    """Configuration for pipeline behavior (dedup, scoring, gap analysis)."""

    dedup_batch_size: int = 50
    min_entry_score: float = 0.15
    gap_analysis: bool = True
    iterative_deepening: bool = False
    reuse_cached_extractions: bool = True


class ScheduleTarget(BaseModel):
    """A single location+issues pair to run on a schedule."""

    location: str
    issues: list[str] = Field(default_factory=list)
    search_depth: str = "standard"


class ScheduleConfig(BaseModel):
    """Configuration for automated scheduled discovery runs."""

    enabled: bool = False
    cron: str = "0 2 * * *"
    max_concurrent_runs: int = 2
    targets: list[ScheduleTarget] = Field(default_factory=list)


class ContributionConfig(BaseModel):
    """Configuration for contributing discovered entries back to Atlas."""

    enabled: bool = False
    api_key: str = ""
    atlas_url: str = "https://atlas.rebuildingus.org"
    min_score: float = 0.7


class StoreConfig(BaseModel):
    """Configuration for the local SQLite store path."""

    path: str = str(DEFAULT_DB_PATH)


class ScoutConfig(BaseModel):
    """Root configuration model for Atlas Scout."""

    llm: LLMConfig = Field(default_factory=LLMConfig)
    scraper: ScraperConfig = Field(default_factory=ScraperConfig)
    pipeline: PipelineConfig = Field(default_factory=PipelineConfig)
    runtime: RuntimeConfig = Field(default_factory=RuntimeConfig)
    schedule: ScheduleConfig = Field(default_factory=ScheduleConfig)
    contribution: ContributionConfig = Field(default_factory=ContributionConfig)
    store: StoreConfig = Field(default_factory=StoreConfig)
