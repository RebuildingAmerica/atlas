"""Keep account and identity HTTPS on Workers fetch instead of native TLS."""

import asyncio
import json
from urllib.parse import urlsplit

import httpx


class _ResponseStream(httpx.AsyncByteStream):
    def __init__(self, response, controller, request):
        self.reader = response.body.getReader() if response.body is not None else None
        self.controller = controller
        self.request = request
        self.closed = False

    async def __aiter__(self):
        try:
            if self.reader is not None:
                while True:
                    timeout = self.request.extensions.get("timeout", {}).get("read")
                    chunk = await asyncio.wait_for(self.reader.read(), timeout)
                    if chunk.done:
                        break
                    yield bytes(chunk.value.to_py())
        except TimeoutError:
            raise httpx.ReadTimeout(
                "Hosted HTTP read timed out", request=self.request
            ) from None
        except Exception:
            raise httpx.ReadError(
                "Hosted HTTP read failed", request=self.request
            ) from None
        finally:
            await self.aclose()

    async def aclose(self):
        if self.closed:
            return
        self.closed = True
        try:
            if self.reader is not None:
                await self.reader.cancel()
        finally:
            try:
                if self.reader is not None:
                    self.reader.releaseLock()
            finally:
                self.controller.abort()


class WorkersHttpTransport(httpx.AsyncBaseTransport):
    """Allocate fetch, cancellation and streaming resources inside each invocation.

    HTTPX still owns redirects, cookies, authentication and response decoding.
    Native installations retain their existing transport. No visitor state or
    outbound headers are retained on this adapter between requests.
    """

    def __init__(self, callback_origin=None, access_headers=None):
        self.callback_origin = callback_origin
        self.access_headers = dict(access_headers or {})

    async def handle_async_request(self, request):
        from js import AbortController
        from workers import fetch

        controller = AbortController.new()
        try:
            headers = dict(request.headers.items())
            # A protected candidate must answer workspace callbacks before the
            # canonical domain moves. Never send its service proof elsewhere.
            headers.pop("cf-access-client-id", None)
            headers.pop("cf-access-client-secret", None)
            origin = (request.url.scheme, request.url.host, request.url.port)
            if self.callback_origin == origin:
                headers.update(self.access_headers)
            # Request uncompressed bytes so the runtime and HTTPX cannot both
            # decode the same payload. HTTPX retains its response contract.
            headers["accept-encoding"] = "identity"
            body = await request.aread()
            response = await asyncio.wait_for(
                fetch(
                    str(request.url),
                    method=request.method,
                    headers=headers,
                    body=body
                    if body or request.method not in {"GET", "HEAD"}
                    else None,
                    redirect="manual",
                    signal=controller.signal,
                ),
                request.extensions.get("timeout", {}).get("connect"),
            )
            return httpx.Response(
                response.status,
                headers=list(response.headers.items()),
                stream=_ResponseStream(response, controller, request),
                request=request,
            )
        except BaseException as error:
            controller.abort()
            if isinstance(error, TimeoutError):
                raise httpx.ConnectTimeout(
                    "Hosted HTTP request timed out", request=request
                ) from None
            if isinstance(error, Exception):
                raise httpx.ConnectError(
                    "Hosted HTTP request failed", request=request
                ) from None
            raise


def workers_http_transport_factory(env):
    """Scope existing Access proof to the publisher-selected callback origin."""
    settings = json.loads(env.ATLAS_API_SETTINGS)
    keys = (
        "ATLAS_CALLBACK_ACCESS_ORIGIN",
        "ATLAS_CALLBACK_ACCESS_CLIENT_ID",
        "ATLAS_CALLBACK_ACCESS_CLIENT_SECRET",
    )
    values = [settings.get(key) for key in keys]
    if not any(value is not None for value in values):
        return WorkersHttpTransport
    if not all(isinstance(value, str) and value.strip() for value in values):
        raise ValueError("Incomplete hosted callback Access configuration")
    origin = urlsplit(values[0])
    if (
        origin.scheme != "https"
        or not origin.hostname
        or origin.username is not None
        or origin.password is not None
        or origin.path not in ("", "/")
        or origin.query
        or origin.fragment
    ):
        raise ValueError("Invalid hosted callback Access origin")
    target = httpx.URL(values[0])
    allowed_origin = (target.scheme, target.host, target.port)
    headers = {
        "CF-Access-Client-Id": values[1],
        "CF-Access-Client-Secret": values[2],
    }
    return lambda: WorkersHttpTransport(allowed_origin, headers)
