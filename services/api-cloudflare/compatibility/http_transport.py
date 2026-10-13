"""Keep account and identity HTTPS on Workers fetch instead of native TLS."""

import asyncio

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

    async def handle_async_request(self, request):
        from js import AbortController
        from workers import fetch

        controller = AbortController.new()
        try:
            headers = dict(request.headers.items())
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
