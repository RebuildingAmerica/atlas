"""Tests for the LM Studio LLM provider."""

from __future__ import annotations

import json

import httpx
import respx
from pydantic import BaseModel

from atlas_scout.providers.base import Completion, LLMProvider, Message
from atlas_scout.providers.lmstudio import LMStudioProvider


def test_lmstudio_is_llm_provider() -> None:
    provider = LMStudioProvider(model="qwen3:latest")

    assert isinstance(provider, LLMProvider)


def test_lmstudio_cache_identity_includes_model() -> None:
    provider = LMStudioProvider(model="qwen3:latest")

    assert provider.cache_identity == "lmstudio:qwen3:latest"


@respx.mock
async def test_lmstudio_complete_structured_output() -> None:
    class Person(BaseModel):
        name: str
        age: int

    route = respx.post("http://localhost:1234/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": json.dumps({"name": "Alice", "age": 30}),
                        }
                    }
                ],
                "usage": {"prompt_tokens": 12, "completion_tokens": 6},
            },
        )
    )
    provider = LMStudioProvider(model="qwen3:latest")

    result = await provider.complete(
        [Message(role="user", content="Give me a person")],
        response_schema=Person,
    )

    request = route.calls.last.request
    payload = json.loads(request.content)
    assert payload["model"] == "qwen3:latest"
    assert payload["stream"] is False
    assert payload["response_format"]["type"] == "json_schema"
    assert payload["response_format"]["json_schema"]["strict"] is True
    assert isinstance(result, Completion)
    assert result.parsed == {"name": "Alice", "age": 30}
    assert result.usage == {"prompt_tokens": 12, "completion_tokens": 6}


@respx.mock
async def test_lmstudio_sends_bearer_token_when_configured() -> None:
    route = respx.post("http://studio.test/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [{"message": {"role": "assistant", "content": "hello"}}],
                "usage": {},
            },
        )
    )
    provider = LMStudioProvider(
        model="qwen3:latest",
        base_url="http://studio.test/v1",
        api_key="local-token",
    )

    result = await provider.complete([Message(role="user", content="Hi")])

    assert route.calls.last.request.headers["authorization"] == "Bearer local-token"
    assert result.text == "hello"
