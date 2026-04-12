"""Tests for the Ollama LLM provider."""

from __future__ import annotations

import json

import httpx
import pytest
import respx
from pydantic import BaseModel

from atlas_scout.providers.base import Completion, LLMProvider, Message
from atlas_scout.providers.ollama import OllamaProvider


def test_ollama_is_llm_provider() -> None:
    provider = OllamaProvider(model="llama3.1:8b")
    assert isinstance(provider, LLMProvider)


def test_ollama_max_concurrent_default() -> None:
    provider = OllamaProvider(model="llama3.1:8b")
    assert provider.max_concurrent == 10


@respx.mock
async def test_ollama_complete_plain_text() -> None:
    respx.post("http://localhost:11434/api/chat").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": {"role": "assistant", "content": "Hello from Ollama!"},
                "prompt_eval_count": 10,
                "eval_count": 5,
            },
        )
    )
    provider = OllamaProvider(model="llama3.1:8b")
    result = await provider.complete([Message(role="user", content="Hi")])
    assert isinstance(result, Completion)
    assert result.text == "Hello from Ollama!"
    assert result.usage["prompt_tokens"] == 10


@respx.mock
async def test_ollama_complete_structured_output() -> None:
    class Person(BaseModel):
        name: str
        age: int

    respx.post("http://localhost:11434/api/chat").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": {
                    "role": "assistant",
                    "content": json.dumps({"name": "Alice", "age": 30}),
                },
                "prompt_eval_count": 15,
                "eval_count": 8,
            },
        )
    )
    provider = OllamaProvider(model="llama3.1:8b")
    result = await provider.complete(
        [Message(role="user", content="Give me a person")],
        response_schema=Person,
    )
    assert result.parsed is not None
    assert result.parsed["name"] == "Alice"
    assert result.parsed["age"] == 30


@respx.mock
async def test_ollama_complete_usage_tokens() -> None:
    respx.post("http://localhost:11434/api/chat").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": {"role": "assistant", "content": "test"},
                "prompt_eval_count": 42,
                "eval_count": 7,
            },
        )
    )
    provider = OllamaProvider(model="llama3.1:8b")
    result = await provider.complete([Message(role="user", content="ping")])
    assert result.usage["prompt_tokens"] == 42
    assert result.usage["completion_tokens"] == 7


@respx.mock
async def test_ollama_custom_base_url() -> None:
    respx.post("http://myhost:11434/api/chat").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": {"role": "assistant", "content": "hi"},
                "prompt_eval_count": 1,
                "eval_count": 1,
            },
        )
    )
    provider = OllamaProvider(model="llama3.1:8b", base_url="http://myhost:11434")
    result = await provider.complete([Message(role="user", content="hey")])
    assert result.text == "hi"
