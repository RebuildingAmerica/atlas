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
        ...  # pragma: no cover

    @property
    def cache_identity(self) -> str:
        """Stable cache key fragment for reuse of extraction results."""
        ...  # pragma: no cover

    async def complete(
        self,
        messages: list[Message],
        response_schema: type[BaseModel] | None = None,
    ) -> Completion:
        """Send a list of messages to the LLM and return a Completion."""
        ...  # pragma: no cover

    async def aclose(self) -> None:
        """Release provider-held resources such as an open HTTP client."""
        ...  # pragma: no cover
