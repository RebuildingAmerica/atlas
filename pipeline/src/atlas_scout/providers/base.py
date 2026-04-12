"""Base protocol and types for LLM providers."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel


class Message(BaseModel):
    role: str  # "system", "user", "assistant"
    content: str


class Completion(BaseModel):
    text: str
    parsed: dict[str, Any] | None = None
    usage: dict[str, int] = {}


@runtime_checkable
class LLMProvider(Protocol):
    @property
    def max_concurrent(self) -> int: ...

    async def complete(
        self,
        messages: list[Message],
        response_schema: type[BaseModel] | None = None,
    ) -> Completion: ...
