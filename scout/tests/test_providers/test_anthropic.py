"""Tests for the Anthropic LLM provider."""

from __future__ import annotations

import json

import httpx
import respx
from pydantic import BaseModel

from atlas_scout.providers.anthropic import AnthropicProvider
from atlas_scout.providers.base import LLMProvider, Message


def test_anthropic_is_llm_provider() -> None:
    provider = AnthropicProvider(model="claude-sonnet-4-20250514", api_key="test-key")
    assert isinstance(provider, LLMProvider)


@respx.mock
async def test_anthropic_complete_plain_text() -> None:
    respx.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "Hello from Claude!"}],
                "usage": {"input_tokens": 10, "output_tokens": 5},
            },
        )
    )
    provider = AnthropicProvider(model="claude-sonnet-4-20250514", api_key="test-key")
    result = await provider.complete([Message(role="user", content="Hi")])
    assert result.text == "Hello from Claude!"
    assert result.usage["prompt_tokens"] == 10


@respx.mock
async def test_anthropic_complete_structured() -> None:
    class Person(BaseModel):
        name: str
        age: int

    respx.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": json.dumps({"name": "Bob", "age": 25})}],
                "usage": {"input_tokens": 20, "output_tokens": 10},
            },
        )
    )
    provider = AnthropicProvider(model="claude-sonnet-4-20250514", api_key="test-key")
    result = await provider.complete(
        [Message(role="user", content="person please")],
        response_schema=Person,
    )
    assert result.parsed == {"name": "Bob", "age": 25}


@respx.mock
async def test_anthropic_strips_markdown_code_fence() -> None:
    class Data(BaseModel):
        value: int

    fenced = "```json\n{\"value\": 99}\n```"
    respx.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": fenced}],
                "usage": {"input_tokens": 5, "output_tokens": 5},
            },
        )
    )
    provider = AnthropicProvider(model="claude-sonnet-4-20250514", api_key="test-key")
    result = await provider.complete(
        [Message(role="user", content="give me data")],
        response_schema=Data,
    )
    assert result.parsed is not None
    assert result.parsed["value"] == 99


@respx.mock
async def test_anthropic_system_message_separated() -> None:
    """System messages must be sent in the top-level 'system' field, not in messages."""
    route = respx.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "ok"}],
                "usage": {"input_tokens": 5, "output_tokens": 1},
            },
        )
    )
    provider = AnthropicProvider(model="claude-sonnet-4-20250514", api_key="test-key")
    await provider.complete([
        Message(role="system", content="You are helpful."),
        Message(role="user", content="Hello"),
    ])

    sent = json.loads(route.calls[0].request.content)
    assert sent["system"] == "You are helpful."
    # Only the user message should appear in messages, not the system one
    assert all(m["role"] != "system" for m in sent["messages"])


@respx.mock
async def test_anthropic_usage_tokens() -> None:
    respx.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "done"}],
                "usage": {"input_tokens": 33, "output_tokens": 12},
            },
        )
    )
    provider = AnthropicProvider(model="claude-sonnet-4-20250514", api_key="test-key")
    result = await provider.complete([Message(role="user", content="go")])
    assert result.usage["prompt_tokens"] == 33
    assert result.usage["completion_tokens"] == 12
