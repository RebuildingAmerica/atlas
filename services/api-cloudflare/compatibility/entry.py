"""Read-only runtime evaluation; never a production API or migration job."""

from fastapi import FastAPI, Request
from workers import DurableObject, WorkerEntrypoint, asgi

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def private_response(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "private, no-store"
    return response


@app.get("/health")
async def health():
    return {"status": "ok", "runtime": "python-durable-object"}


@app.get("/database")
async def database(request: Request):
    import asyncpg

    hyperdrive = request.scope["env"].HYPERDRIVE
    # No schema writes, user records, or credentials leave this probe.
    connection = await asyncpg.connect(
        host=hyperdrive.host,
        port=int(hyperdrive.port),
        user=hyperdrive.user,
        password=hyperdrive.password,
        database=hyperdrive.database,
        ssl=False,
        server_settings={"TimeZone": "UTC"},
    )
    try:
        # Hyperdrive transaction pooling may discard driver startup settings.
        # Keep timestamp interpretation stable for source dates and account data.
        async with connection.transaction():
            await connection.execute("SET LOCAL TIME ZONE 'UTC'")
            row = await connection.fetchrow("SELECT 1, current_setting('TimeZone')")
    finally:
        await connection.close()
    return {"query": row[0], "timezone": row[1], "connection_closed": connection.is_closed()}


class ApiRuntime(DurableObject):
    async def fetch(self, request):
        return await asgi.fetch(app, request, self.env)


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        # Service binding only. No public hostname or workers.dev route.
        return await self.env.API_RUNTIME.getByName("compatibility").fetch(request)
