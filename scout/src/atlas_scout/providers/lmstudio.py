"""LM Studio LLM provider using the OpenAI-compatible local API."""

from __future__ import annotations

import json
import os
from typing import TYPE_CHECKING, Any

import httpx

from atlas_scout.providers.base import Completion, Message

if TYPE_CHECKING:
    from pydantic import BaseModel

DEFAULT_LMSTUDIO_URL = "http://localhost:1234/v1"


class LMStudioProvider:
    """LLM provider that connects to a local LM Studio server."""

    def __init__(
        self,
        model: str,
        base_url: str = DEFAULT_LMSTUDIO_URL,
        api_key: str | None = None,
        max_concurrent: int = 10,
        timeout_seconds: float = 120.0,
    ) -> None:
        """Initialize the provider with a model, base URL, and optional token."""
        self._model = model
        self._base_url = normalize_lmstudio_base_url(base_url)
        self._api_key = api_key or os.environ.get("LM_STUDIO_API_KEY")
        self._max_concurrent = max_concurrent
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds, connect=min(timeout_seconds, 10.0))
        )

    @property
    def max_concurrent(self) -> int:
        """Maximum number of concurrent LLM requests allowed."""
        return self._max_concurrent

    @property
    def cache_identity(self) -> str:
        """Stable cache key fragment for reuse of extraction results."""
        return f"lmstudio:{self._model}"

    async def aclose(self) -> None:
        """Close the shared HTTP client."""
        await self._client.aclose()

    async def complete(
        self,
        messages: list[Message],
        response_schema: type[BaseModel] | None = None,
    ) -> Completion:
        """Send messages to LM Studio and return a Completion."""
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [message.model_dump() for message in messages],
            "stream": False,
        }
        if response_schema is not None:
            payload["response_format"] = _response_format(response_schema)

        response = await self._client.post(
            f"{self._base_url}/chat/completions",
            json=payload,
            headers=_auth_headers(self._api_key),
        )
        response.raise_for_status()
        data = response.json()
        text = str(data["choices"][0]["message"]["content"])

        parsed: dict[str, Any] | None = None
        if response_schema is not None:
            parsed_raw = json.loads(text)
            parsed = response_schema.model_validate(parsed_raw).model_dump()

        raw_usage = data.get("usage", {})
        usage = raw_usage if isinstance(raw_usage, dict) else {}
        return Completion(
            text=text,
            parsed=parsed,
            usage={
                "prompt_tokens": int(usage.get("prompt_tokens", 0)),
                "completion_tokens": int(usage.get("completion_tokens", 0)),
            },
        )


def normalize_lmstudio_base_url(base_url: str) -> str:
    """Return an LM Studio OpenAI-compatible base URL ending in ``/v1``."""
    normalized = base_url.rstrip("/")
    if normalized.endswith("/v1"):
        return normalized
    return f"{normalized}/v1"


def _response_format(response_schema: type[BaseModel]) -> dict[str, object]:
    """Return LM Studio's OpenAI-compatible structured-output payload."""
    return {
        "type": "json_schema",
        "json_schema": {
            "name": response_schema.__name__,
            "strict": True,
            "schema": response_schema.model_json_schema(),
        },
    }


def _auth_headers(api_key: str | None) -> dict[str, str] | None:
    """Return optional authorization headers for token-protected LM Studio servers."""
    if not api_key:
        return None
    return {"Authorization": f"Bearer {api_key}"}
