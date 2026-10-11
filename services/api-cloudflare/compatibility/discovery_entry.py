"""Isolate native discovery memory from the HTTP API; never a production worker."""

from urllib.parse import urlsplit

from native_probe import archive_checks, name_checks, native_checks
from workers import DurableObject, Response, WorkerEntrypoint


class ApiRuntime(DurableObject):
    async def fetch(self, request):
        path = urlsplit(request.url).path
        checks = {
            "/health": lambda: {"status": "ok", "runtime": "python-durable-object"},
            "/archive": archive_checks,
            "/names": name_checks,
            "/native": native_checks,
        }
        check = checks.get(path)
        if check is None:
            return Response("Not found", status=404)
        # Fixed examples only. Never log names or archive content from user work.
        print("discovery_probe_start", path)
        result = check()
        print("discovery_probe_complete", path)
        return Response.json(result, headers={"Cache-Control": "private, no-store"})


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return await self.env.API_RUNTIME.getByName("compatibility").fetch(request)
