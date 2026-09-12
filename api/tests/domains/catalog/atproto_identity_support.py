"""Fakes standing in for DNS, HTTP and DID resolution.

Every ATProto identity test needs these, and a test that reached the real
network would fail in CI and pass at a desk.
"""

from __future__ import annotations

from typing import Any, ClassVar


class _Resolver:
    def __init__(self, *, did: str | None, did_doc: dict[str, Any] | None) -> None:
        self.did = did
        self.did_doc = did_doc
        self.handles: list[str] = []
        self.dids: list[str] = []

    async def handle_resolves_to_did(self, handle: str) -> str | None:
        self.handles.append(handle)
        return self.did

    async def did_document(self, did: str) -> dict[str, Any] | None:
        self.dids.append(did)
        return self.did_doc


class _TxtAnswer:
    def __init__(self, value: str | None = None, *, chunks: tuple[bytes, ...] = ()) -> None:
        self.strings = chunks
        self.value = value

    def to_text(self) -> str:
        return self.value or ""


class _FakeDnsResolver:
    def __init__(self, answers: list[_TxtAnswer] | Exception) -> None:
        self.answers = answers
        self.lifetime = 0.0
        self.queries: list[tuple[str, str]] = []

    async def resolve(self, name: str, record_type: str) -> list[_TxtAnswer]:
        self.queries.append((name, record_type))
        if isinstance(self.answers, Exception):
            raise self.answers
        return self.answers


class _FakeHttpResponse:
    def __init__(self, *, status_code: int, text: str = "", payload: object = None) -> None:
        self.status_code = status_code
        self.text = text
        self.payload = payload

    def json(self) -> object:
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


class _FakeHttpClient:
    responses: ClassVar[list[_FakeHttpResponse | Exception]] = []
    requests: ClassVar[list[str]] = []

    def __init__(self, **_kwargs: object) -> None:
        pass

    async def __aenter__(self) -> _FakeHttpClient:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        return None

    async def get(self, url: str) -> _FakeHttpResponse:
        self.requests.append(url)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response
