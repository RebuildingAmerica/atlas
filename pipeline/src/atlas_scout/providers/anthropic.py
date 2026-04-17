"""Anthropic LLM provider using raw httpx (no SDK)."""

from __future__ import annotations

import json
import os
from typing import TYPE_CHECKING, Any

import httpx

from atlas_scout.pipeline_support import strip_code_fence as _strip_code_fence
from atlas_scout.providers.base import Completion, Message

if TYPE_CHECKING:
    from pydantic import BaseModel

_ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
_ANTHROPIC_VERSION = "2023-06-01"
_MAX_TOKENS = 4096


class AnthropicProvider:
    """LLM provider that calls the Anthropic Messages API directly via httpx."""

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        max_concurrent: int = 10,
        timeout_seconds: float = 120.0,
    ) -> None:
        """Initialize the provider with a model, optional API key, and concurrency limit."""
        self._model = model
        self._api_key = api_key or os.environ.get("ANTHROPIC_API_KEY") or ""
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
        return f"anthropic:{self._model}"

    async def aclose(self) -> None:
        """Close the shared HTTP client."""
        await self._client.aclose()

    async def complete(
        self,
        messages: list[Message],
        response_schema: type[BaseModel] | None = None,
    ) -> Completion:
        """Send messages to the Anthropic API and return a Completion."""
        # Separate system messages from the rest
        system_parts: list[str] = []
        chat_messages: list[dict[str, str]] = []

        for msg in messages:
            if msg.role == "system":
                system_parts.append(msg.content)
            else:
                chat_messages.append({"role": msg.role, "content": msg.content})

        payload: dict[str, Any] = {
            "model": self._model,
            "max_tokens": _MAX_TOKENS,
            "messages": chat_messages,
        }

        if system_parts:
            payload["system"] = "\n\n".join(system_parts)

        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": _ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

        response = await self._client.post(
            _ANTHROPIC_API_URL,
            json=payload,
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()

        text: str = data["content"][0]["text"]
        raw_usage: dict[str, int] = data.get("usage", {})

        usage = {
            "prompt_tokens": raw_usage.get("input_tokens", 0),
            "completion_tokens": raw_usage.get("output_tokens", 0),
        }

        parsed: dict[str, Any] | None = None
        if response_schema is not None:
            clean = _strip_code_fence(text)
            parsed_raw = json.loads(clean)
            parsed = response_schema.model_validate(parsed_raw).model_dump()

        return Completion(text=text, parsed=parsed, usage=usage)
