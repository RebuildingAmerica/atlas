"""Read public research sources with request-owned Workers fetch resources."""

from contextlib import asynccontextmanager


@asynccontextmanager
async def workers_public_source_fetch(url, headers):
    """Yield one decoded response; the caller validates every redirect and bound.

    Global fetch uses ``global_fetch_strictly_public`` in the release config.
    No incoming Request, application credentials or private service binding is
    accepted here. Allocate network resources inside the current invocation so
    concurrent discovery runs cannot share identities or unfinished requests.
    """
    from atlas.domains.discovery.pipeline.source_http import PublicSourceResponse
    from js import AbortController
    from workers import fetch

    controller = AbortController.new()
    reader = None
    request_error = None
    try:
        response = await fetch(
            url, headers=dict(headers), redirect="manual", signal=controller.signal
        )
        if response.body is not None:
            reader = response.body.getReader()

        async def decoded_body():
            if reader is not None:
                while True:
                    chunk = await reader.read()
                    if chunk.done:
                        break
                    yield bytes(chunk.value.to_py())

        yield PublicSourceResponse(
            status_code=response.status,
            headers=dict(response.headers.items()),
            body=decoded_body(),
        )
    except BaseException as error:
        request_error = error
        raise
    finally:
        try:
            if reader is not None:
                await reader.cancel()
        except BaseException as cleanup_error:
            if request_error is not None:
                raise request_error from cleanup_error
            raise
        finally:
            try:
                if reader is not None:
                    reader.releaseLock()
            finally:
                controller.abort()
