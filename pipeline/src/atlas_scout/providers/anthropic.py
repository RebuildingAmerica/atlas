"""Anthropic LLM provider using raw httpx (no SDK)."""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx
from pydantic import BaseModel

from atlas_scout.providers.base import Completion, Message

_ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
_ANTHROPIC_VERSION = "2023-06-01"
_MAX_TOKENS = 4096

# Matches optional leading ```json or ``` and trailing ```
_CODE_FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL)


def _strip_code_fence(text: str) -> str:
    match = _CODE_FENCE_RE.match(text.strip())
    return match.group(1) if match else text


class AnthropicProvider:
    """LLM provider that calls the Anthropic Messages API directly via httpx."""

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        max_concurrent: int = 10,
    ) -> None:
        self._model = model
        self._api_key = api_key or os.environ.get("ANTHROPIC_API_KEY") or ""
        self._max_concurrent = max_concurrent

    @property
    def max_concurrent(self) -> int:
        return self._max_concurrent

    async def complete(
        self,
        messages: list[Message],
        response_schema: type[BaseModel] | None = None,
    ) -> Completion:
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

        async with httpx.AsyncClient() as client:
            response = await client.post(
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
            parsed = json.loads(clean)

        return Completion(text=text, parsed=parsed, usage=usage)
