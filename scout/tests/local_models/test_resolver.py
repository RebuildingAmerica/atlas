"""Local model resolver tests."""

from __future__ import annotations

from atlas_scout.config import ScoutConfig
from atlas_scout.local_models import (
    DEFAULT_OLLAMA_URL,
    LocalModelProbe,
    apply_local_model_resolution,
    is_local_provider,
    resolve_local_model,
)


def test_is_local_provider_accepts_ollama_and_lmstudio() -> None:
    assert is_local_provider("ollama")
    assert is_local_provider("lmstudio")
    assert not is_local_provider("anthropic")


def test_resolver_keeps_active_healthy_config() -> None:
    config = ScoutConfig()
    config.llm.provider = "ollama"
    config.llm.model = "qwen3:latest"

    resolution = resolve_local_model(
        config,
        probe=lambda provider, _config: LocalModelProbe(
            provider=provider,
            base_url="http://localhost:11434",
            status="ready",
            models=("qwen3:latest", "llama3.1:8b"),
            message="Ollama is ready.",
        ),
    )

    assert resolution.ready
    assert resolution.provider == "ollama"
    assert resolution.model == "qwen3:latest"
    assert not resolution.changed


def test_resolver_self_heals_default_config_to_lmstudio() -> None:
    config = ScoutConfig()

    def probe(provider: str, _config: ScoutConfig) -> LocalModelProbe:
        if provider == "lmstudio":
            return LocalModelProbe(
                provider="lmstudio",
                base_url="http://localhost:1234/v1",
                status="ready",
                models=("qwen3:latest",),
                message="LM Studio is ready.",
            )
        return LocalModelProbe(
            provider="ollama",
            base_url="http://localhost:11434",
            status="unreachable",
            models=(),
            message="Ollama is not reachable.",
            remediation="Start Ollama.",
        )

    resolution = resolve_local_model(config, probe=probe)

    assert resolution.ready
    assert resolution.provider == "lmstudio"
    assert resolution.model == "qwen3:latest"
    assert resolution.changed

    apply_local_model_resolution(config, resolution)

    assert config.llm.provider == "lmstudio"
    assert config.llm.model == "qwen3:latest"
    assert config.llm.base_url == "http://localhost:1234/v1"


def test_resolver_self_heals_stale_configured_base_url_to_localhost() -> None:
    config = ScoutConfig()
    config.llm.provider = "ollama"
    config.llm.model = "deepseek-r1:8b"
    config.llm.base_url = "http://willies-mac-studio.tail244fac.ts.net:11434"
    seen_base_urls: list[str | None] = []

    def probe(provider: str, candidate: ScoutConfig) -> LocalModelProbe:
        seen_base_urls.append(candidate.llm.base_url)
        if provider == "ollama" and candidate.llm.base_url is None:
            return LocalModelProbe(
                provider="ollama",
                base_url=DEFAULT_OLLAMA_URL,
                status="ready",
                models=("deepseek-r1:8b",),
                message="Ollama is ready.",
            )
        return LocalModelProbe(
            provider=provider,
            base_url=candidate.llm.base_url or "http://localhost",
            status="unreachable",
            models=(),
            message=f"{provider} is not reachable.",
        )

    resolution = resolve_local_model(config, probe=probe)

    assert resolution.ready
    assert resolution.provider == "ollama"
    assert resolution.model == "deepseek-r1:8b"
    assert resolution.base_url == DEFAULT_OLLAMA_URL
    assert resolution.changed
    assert config.llm.base_url in seen_base_urls
    assert None in seen_base_urls


def test_resolver_returns_one_clear_action_when_no_provider_is_ready() -> None:
    config = ScoutConfig()

    resolution = resolve_local_model(
        config,
        probe=lambda provider, _config: LocalModelProbe(
            provider=provider,
            base_url="http://localhost:11434",
            status="unreachable",
            models=(),
            message=f"{provider} is not reachable.",
            remediation=f"Start {provider}.",
        ),
    )

    assert not resolution.ready
    assert resolution.provider is None
    assert "Start Ollama or LM Studio" in str(resolution.remediation)
