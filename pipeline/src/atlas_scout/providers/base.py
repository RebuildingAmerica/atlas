"""Base protocol and types for LLM providers."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel


class Message(BaseModel):
    """A single chat message with a role and text content."""

    role: str  # "system", "user", "assistant"
    content: str


class Completion(BaseModel):
    """The result of an LLM completion call, including raw text and optional parsed data."""

    text: str
    parsed: dict[str, Any] | None = None
    usage: dict[str, int] = {}


@runtime_checkable
class LLMProvider(Protocol):
    """Protocol that all LLM provider implementations must satisfy."""

    @property
    def max_concurrent(self) -> int:
        """Maximum number of concurrent requests the provider supports."""
        ...

    async def complete(
        self,
        messages: list[Message],
        response_schema: type[BaseModel] | None = None,
    ) -> Completion:
        """Send a list of messages to the LLM and return a Completion."""
        ...
