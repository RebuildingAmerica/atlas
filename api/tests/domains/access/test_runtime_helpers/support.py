"""Shared runtime helper test utilities."""

from __future__ import annotations

BAD_TOKEN_ERROR = "bad token"


class _FakeAsyncClient:
    def __init__(self, response: object) -> None:
        self._response = response

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None

    async def post(self, url: str, headers: dict[str, str]) -> object:
        self.url = url
        self.headers = headers
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


def _async_client_factory(response: object) -> object:
    def factory(*, timeout: float) -> _FakeAsyncClient:
        del timeout
        return _FakeAsyncClient(response)

    return factory
