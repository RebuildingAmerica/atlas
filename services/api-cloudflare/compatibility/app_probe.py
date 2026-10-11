"""Read-only runtime evaluation; never a production API or migration job."""

from uuid import UUID

from fastapi import FastAPI, Request

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def private_response(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "private, no-store"
    return response


@app.get("/health")
async def health():
    return {"status": "ok", "runtime": "python-durable-object"}


@app.get("/imports")
async def imports():
    # Construct existing routes without lifespan: no migrations or job startup.
    from atlas.main import app as atlas_app

    return {"status": "ok", "routes": len(atlas_app.routes)}


@app.get("/native")
async def native():
    from native_probe import native_checks

    return native_checks()


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
            row = await connection.fetchrow(
                "SELECT 1, current_setting('TimeZone'), "
                "EXTRACT(TIMEZONE FROM CURRENT_TIMESTAMP)::int, "
                "TIMESTAMPTZ '2000-01-01T05:30:00+05:30'"
            )
    finally:
        await connection.close()
    return {
        "query": row[0],
        "timezone": row[1],
        "timezone_offset_seconds": row[2],
        "timestamp": row[3].isoformat(),
        "connection_closed": connection.is_closed(),
    }


@app.get("/database-adapter/{probe}")
async def database_adapter(request: Request, probe: UUID):
    from database_adapter import connect_database

    hd = request.scope["env"].HYPERDRIVE
    connection = await connect_database(
        host=hd.host,
        port=int(hd.port),
        user=hd.user,
        password=hd.password,
        database=hd.database,
    )
    try:
        cursor = await connection.execute(
            "SELECT ?::text AS probe, ?::timestamptz AS source_date, "
            "?::jsonb AS evidence, current_setting('TimeZone') AS timezone",
            (str(probe), "2000-01-01T05:30:00+05:30", '{"trusted":true}'),
        )
        row = await cursor.fetchone()
        result = {
            "probe": row[0],
            "timestamp": row[1],
            "evidence": row[2],
            "timezone": row[3],
            "columns": [column[0] for column in cursor.description],
            "rowcount": cursor.rowcount,
            "cursor_exhausted": await cursor.fetchone() is None,
        }
    finally:
        await connection.close()
    return {**result, "connection_closed": connection.is_closed()}
