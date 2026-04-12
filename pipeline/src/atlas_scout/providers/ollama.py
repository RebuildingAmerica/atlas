"""Ollama LLM provider using raw httpx."""

from __future__ import annotations

import json
from typing import Any

import httpx
from pydantic import BaseModel

from atlas_scout.providers.base import Completion, Message


class OllamaProvider:
    """LLM provider that connects to a local Ollama instance."""

    def __init__(
        self,
        model: str,
        base_url: str = "http://localhost:11434",
        max_concurrent: int = 10,
    ) -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._max_concurrent = max_concurrent

    @property
    def max_concurrent(self) -> int:
        return self._max_concurrent

    async def complete(
        self,
        messages: list[Message],
        response_schema: type[BaseModel] | None = None,
    ) -> Completion:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [m.model_dump() for m in messages],
            "stream": False,
        }

        if response_schema is not None:
            payload["format"] = response_schema.model_json_schema()

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self._base_url}/api/chat",
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        text: str = data["message"]["content"]

        parsed: dict[str, Any] | None = None
        if response_schema is not None:
            parsed = json.loads(text)

        usage = {
            "prompt_tokens": data.get("prompt_eval_count", 0),
            "completion_tokens": data.get("eval_count", 0),
        }

        return Completion(text=text, parsed=parsed, usage=usage)
