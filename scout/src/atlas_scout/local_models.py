"""Local model provider discovery and selection for Scout."""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

import httpx

from atlas_scout.providers.lmstudio import DEFAULT_LMSTUDIO_URL, normalize_lmstudio_base_url
from atlas_scout.providers.ollama import DEFAULT_OLLAMA_URL

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig

LocalProviderName = Literal["ollama", "lmstudio"]
LocalModelStatus = Literal[
    "ready",
    "unreachable",
    "auth_required",
    "invalid_response",
    "no_models",
]

LOCAL_PROVIDER_NAMES: tuple[LocalProviderName, ...] = ("lmstudio", "ollama")
LOCAL_PROVIDER_LABELS: dict[LocalProviderName, str] = {
    "lmstudio": "LM Studio",
    "ollama": "Ollama",
}


@dataclass(frozen=True, slots=True)
class LocalModelProbe:
    """Result of probing one local model provider."""

    provider: LocalProviderName
    base_url: str
    status: LocalModelStatus
    models: tuple[str, ...]
    message: str
    remediation: str | None = None


@dataclass(frozen=True, slots=True)
class LocalModelChoice:
    """One selectable local model candidate."""

    provider: LocalProviderName
    model: str
    base_url: str


@dataclass(frozen=True, slots=True)
class LocalModelResolution:
    """Selected local model settings, or one action needed to make them available."""

    ready: bool
    provider: LocalProviderName | None
    model: str | None
    base_url: str | None
    message: str
    remediation: str | None = None
    changed: bool = False
    choices: tuple[LocalModelChoice, ...] = ()


ProbeLocalModel = Callable[[LocalProviderName, "ScoutConfig"], LocalModelProbe]


def is_local_provider(provider: str) -> bool:
    """Return whether the provider name identifies a local model server."""
    return provider.strip().lower() in LOCAL_PROVIDER_NAMES


def provider_label(provider: LocalProviderName | str) -> str:
    """Return the user-facing provider label."""
    normalized = provider.strip().lower()
    if normalized in LOCAL_PROVIDER_LABELS:
        return LOCAL_PROVIDER_LABELS[normalized]
    return provider


def resolve_local_model(
    config: ScoutConfig,
    *,
    probe: ProbeLocalModel = lambda provider, config: probe_local_model(provider, config),
) -> LocalModelResolution:
    """Return the best local model configuration Scout can use right now."""
    configured_provider = _configured_local_provider(config)
    probes = tuple(
        candidate
        for provider in LOCAL_PROVIDER_NAMES
        for candidate in _probe_provider_candidates(provider, config, probe)
    )

    if configured_provider is not None:
        current = _probe_for_provider(probes, configured_provider)
        if current is not None and current.status == "ready" and config.llm.model in current.models:
            return LocalModelResolution(
                ready=True,
                provider=configured_provider,
                model=config.llm.model,
                base_url=current.base_url,
                message=(f"Using {provider_label(configured_provider)} with {config.llm.model}."),
                changed=_resolved_endpoint_changes(config, configured_provider, current.base_url),
                choices=_choices_from_probes(probes, config.llm.model),
            )

    choices = _choices_from_probes(probes, config.llm.model)
    if choices:
        choice = choices[0]
        return LocalModelResolution(
            ready=True,
            provider=choice.provider,
            model=choice.model,
            base_url=choice.base_url,
            message=f"Using {provider_label(choice.provider)} with {choice.model}.",
            changed=_choice_changes_config(config, choice),
            choices=choices,
        )

    return LocalModelResolution(
        ready=False,
        provider=None,
        model=None,
        base_url=None,
        message="No local model is ready.",
        remediation=_unavailable_remediation(probes),
    )


def apply_local_model_resolution(
    config: ScoutConfig,
    resolution: LocalModelResolution,
) -> None:
    """Apply a ready local model resolution to a Scout config object."""
    if not resolution.ready or resolution.provider is None or resolution.model is None:
        return
    config.llm.provider = resolution.provider
    config.llm.model = resolution.model
    config.llm.set_configured_base_url(resolution.provider, resolution.base_url)


def select_local_model_choice(
    config: ScoutConfig,
    choice: LocalModelChoice,
    choices: tuple[LocalModelChoice, ...],
) -> LocalModelResolution:
    """Return a resolution for a user-selected local model choice."""
    return LocalModelResolution(
        ready=True,
        provider=choice.provider,
        model=choice.model,
        base_url=choice.base_url,
        message=f"Using {provider_label(choice.provider)} with {choice.model}.",
        changed=_choice_changes_config(config, choice),
        choices=choices,
    )


def probe_local_model(provider: LocalProviderName, config: ScoutConfig) -> LocalModelProbe:
    """Probe one local model provider and list available model names."""
    if provider == "ollama":
        return _probe_ollama(config)
    return _probe_lmstudio(config)


def _configured_local_provider(config: ScoutConfig) -> LocalProviderName | None:
    provider = config.llm.provider.strip().lower()
    if provider in LOCAL_PROVIDER_NAMES:
        return provider
    return None


def _probe_for_provider(
    probes: tuple[LocalModelProbe, ...],
    provider: LocalProviderName,
) -> LocalModelProbe | None:
    ready_probe = next(
        (probe for probe in probes if probe.provider == provider and probe.status == "ready"),
        None,
    )
    if ready_probe is not None:
        return ready_probe
    return next((probe for probe in probes if probe.provider == provider), None)


def _probe_provider_candidates(
    provider: LocalProviderName,
    config: ScoutConfig,
    probe: ProbeLocalModel,
) -> tuple[LocalModelProbe, ...]:
    primary = probe(provider, config)
    if not _should_probe_default_local(provider, config, primary):
        return (primary,)

    fallback_config = config.model_copy(deep=True)
    fallback_config.llm.clear_configured_base_url(provider)
    return (primary, probe(provider, fallback_config))


def _should_probe_default_local(
    provider: LocalProviderName,
    config: ScoutConfig,
    primary: LocalModelProbe,
) -> bool:
    return primary.status != "ready" and config.llm.has_configured_base_url(provider)


def _choices_from_probes(
    probes: tuple[LocalModelProbe, ...],
    preferred_model: str,
) -> tuple[LocalModelChoice, ...]:
    choices: list[tuple[int, int, LocalModelChoice]] = []
    for provider_index, probe in enumerate(probes):
        if probe.status != "ready":
            continue
        for model in probe.models:
            choices.append(
                (
                    -_model_score(model, preferred_model),
                    provider_index,
                    LocalModelChoice(
                        provider=probe.provider,
                        model=model,
                        base_url=probe.base_url,
                    ),
                )
            )
    choices.sort(key=lambda item: (item[0], item[1], item[2].model.lower()))
    return tuple(choice for _score, _provider_index, choice in choices)


def _model_score(model: str, preferred_model: str) -> int:
    normalized = model.lower()
    score = 100 if model == preferred_model else 0
    if "embed" in normalized:
        score -= 50
    for marker in (
        "instruct",
        "qwen",
        "llama",
        "gemma",
        "mistral",
        "granite",
        "gpt-oss",
        "deepseek",
        "phi",
    ):
        if marker in normalized:
            score += 10
    return score


def _choice_changes_config(config: ScoutConfig, choice: LocalModelChoice) -> bool:
    return (
        config.llm.provider != choice.provider
        or config.llm.model != choice.model
        or _resolved_endpoint_changes(config, choice.provider, choice.base_url)
    )


def _resolved_endpoint_changes(
    config: ScoutConfig,
    provider: LocalProviderName,
    resolved_base_url: str,
) -> bool:
    configured_base_url = _configured_base_url(config, provider)
    return configured_base_url is not None and configured_base_url != resolved_base_url


def _unavailable_remediation(probes: tuple[LocalModelProbe, ...]) -> str:
    if any(probe.status == "auth_required" for probe in probes):
        return (
            "LM Studio requires an API token. Set LM_STUDIO_API_KEY or disable "
            "LM Studio API authentication."
        )
    if probes and all(probe.status == "no_models" for probe in probes):
        return "Download a chat model in Ollama or LM Studio, then run `scout config llm`."
    return "Start Ollama or LM Studio, then run `scout config llm`."


def _probe_ollama(config: ScoutConfig) -> LocalModelProbe:
    base_url = (_configured_base_url(config, "ollama") or DEFAULT_OLLAMA_URL).rstrip("/")
    try:
        with httpx.Client(timeout=3.0) as client:
            response = client.get(f"{base_url}/api/tags")
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError):
        return LocalModelProbe(
            provider="ollama",
            base_url=base_url,
            status="unreachable",
            models=(),
            message=f"Ollama is not reachable at {base_url}.",
            remediation="Start Ollama, then run `scout config llm`.",
        )

    names = _ollama_model_names(payload)
    if names:
        return LocalModelProbe(
            provider="ollama",
            base_url=base_url,
            status="ready",
            models=tuple(sorted(names)),
            message="Ollama is ready.",
        )
    return LocalModelProbe(
        provider="ollama",
        base_url=base_url,
        status="no_models",
        models=(),
        message="Ollama has no local models.",
        remediation=f"Install a model with `ollama pull {config.llm.model}`.",
    )


def _probe_lmstudio(config: ScoutConfig) -> LocalModelProbe:
    configured_base_url = _configured_base_url(config, "lmstudio")
    base_url = (
        normalize_lmstudio_base_url(configured_base_url)
        if configured_base_url
        else DEFAULT_LMSTUDIO_URL
    )
    api_key = config.llm.api_key or os.environ.get("LM_STUDIO_API_KEY")
    try:
        with httpx.Client(timeout=3.0) as client:
            response = client.get(f"{base_url}/models", headers=_auth_headers(api_key))
            if response.status_code in {401, 403}:
                return LocalModelProbe(
                    provider="lmstudio",
                    base_url=base_url,
                    status="auth_required",
                    models=(),
                    message="LM Studio requires an API token.",
                    remediation="Set LM_STUDIO_API_KEY, then run `scout config llm`.",
                )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError):
        return LocalModelProbe(
            provider="lmstudio",
            base_url=base_url,
            status="unreachable",
            models=(),
            message=f"LM Studio is not reachable at {base_url}.",
            remediation="Start LM Studio's server from Developer, or run `lms server start`.",
        )

    names = _lmstudio_model_names(payload)
    if names:
        return LocalModelProbe(
            provider="lmstudio",
            base_url=base_url,
            status="ready",
            models=tuple(sorted(names)),
            message="LM Studio is ready.",
        )
    return LocalModelProbe(
        provider="lmstudio",
        base_url=base_url,
        status="no_models",
        models=(),
        message="LM Studio has no visible models.",
        remediation="Download a chat model in LM Studio, then run `scout config llm`.",
    )


def _ollama_model_names(payload: object) -> set[str]:
    if not isinstance(payload, dict):
        return set()
    models = payload.get("models")
    if not isinstance(models, list):
        return set()
    names: set[str] = set()
    for model in models:
        if isinstance(model, dict):
            raw_name = model.get("name") or model.get("model")
            if isinstance(raw_name, str) and raw_name.strip():
                names.add(raw_name)
    return names


def _lmstudio_model_names(payload: object) -> set[str]:
    if not isinstance(payload, dict):
        return set()
    models = payload.get("data")
    if not isinstance(models, list):
        return set()
    names: set[str] = set()
    for model in models:
        if isinstance(model, dict):
            raw_id = model.get("id")
            if isinstance(raw_id, str) and raw_id.strip():
                names.add(raw_id)
    return names


def _auth_headers(api_key: str | None) -> dict[str, str] | None:
    if not api_key:
        return None
    return {"Authorization": f"Bearer {api_key}"}


def _configured_base_url(config: ScoutConfig, provider: LocalProviderName) -> str | None:
    return config.llm.configured_base_url(provider)
