"""Helper functions for local model provider discovery."""

from __future__ import annotations

from typing import Any


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


def _configured_base_url(config: Any, provider: str) -> str | None:
    return config.llm.configured_base_url(provider)
