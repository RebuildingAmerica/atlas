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
    import psycopg

    hyperdrive = request.scope["env"].HYPERDRIVE
    # No schema writes, user records, or credentials leave this probe.
    async with await psycopg.AsyncConnection.connect(
        host=hyperdrive.host,
        port=int(hyperdrive.port),
        user=hyperdrive.user,
        password=hyperdrive.password,
        dbname=hyperdrive.database,
        sslmode="disable",
        options="-c TimeZone=UTC",
    ) as connection:
        async with connection.cursor() as cursor:
            await cursor.execute("SELECT 1, current_setting('TimeZone')")
            row = await cursor.fetchone()
    return {"query": row[0], "timezone": row[1], "connection_closed": connection.closed}


class ApiRuntime(DurableObject):
    async def fetch(self, request):
        return await asgi.fetch(app, request, self.env)


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        # Service binding only. No public hostname or workers.dev route.
        return await self.env.API_RUNTIME.getByName("compatibility").fetch(request)
