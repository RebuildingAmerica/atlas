"""Ollama LLM provider using raw httpx."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import httpx

from atlas_scout.providers.base import Completion, Message

if TYPE_CHECKING:
    from pydantic import BaseModel


class OllamaProvider:
    """LLM provider that connects to a local Ollama instance."""

    def __init__(
        self,
        model: str,
        base_url: str = "http://localhost:11434",
        max_concurrent: int = 10,
        timeout_seconds: float = 120.0,
    ) -> None:
        """Initialize the provider with a model name, Ollama base URL, and concurrency limit."""
        self._model = model
        self._base_url = base_url.rstrip("/")
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
        return f"ollama:{self._model}"

    async def aclose(self) -> None:
        """Close the shared HTTP client."""
        await self._client.aclose()

    async def complete(
        self,
        messages: list[Message],
        response_schema: type[BaseModel] | None = None,
    ) -> Completion:
        """Send messages to the Ollama chat API and return a Completion."""
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [m.model_dump() for m in messages],
            "stream": False,
        }

        if response_schema is not None:
            payload["format"] = response_schema.model_json_schema()

        response = await self._client.post(
            f"{self._base_url}/api/chat",
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

        text: str = data["message"]["content"]

        parsed: dict[str, Any] | None = None
        if response_schema is not None:
            parsed_raw = json.loads(text)
            parsed = response_schema.model_validate(parsed_raw).model_dump()

        usage = {
            "prompt_tokens": data.get("prompt_eval_count", 0),
            "completion_tokens": data.get("eval_count", 0),
        }

        return Completion(text=text, parsed=parsed, usage=usage)
