"""Dispatch protected compatibility checks after loading immutable package assets."""

from urllib.parse import urlsplit

from package_bootstrap import ensure_package_archive
from workers import DurableObject, Response, WorkerEntrypoint, asgi


class ApiRuntime(DurableObject):
    async def fetch(self, request):
        path = urlsplit(request.url).path
        if path in {"/timer-cancel/5", "/timer-cancel/30", "/timer-fixed/30"}:
            from timer_probe import cancelled_timer_probe

            fixed = path.startswith("/timer-fixed/")
            if fixed:
                from timer_cleanup import install_timer_cleanup

                if not install_timer_cleanup():
                    raise RuntimeError("The selected hosted loop could not be adapted.")
            result = await cancelled_timer_probe(
                delay_seconds=float(path.rsplit("/", 1)[1])
            )
            return Response.json(
                {**result, "fixed": fixed},
                headers={"Cache-Control": "private, no-store"},
            )
        from timer_cleanup import install_timer_cleanup

        if not install_timer_cleanup():
            raise RuntimeError("The selected hosted loop could not be adapted.")
        await ensure_package_archive(self.env)
        if path == "/imports" or path == "/atlas" or path.startswith("/atlas/"):
            if not hasattr(self, "_application"):
                from hosted_application import create_hosted_application

                self._application, self._route_count = create_hosted_application(
                    self.env, strip_evaluation_prefix=True
                )
            if path == "/imports":
                return Response.json(
                    {"status": "ok", "routes": self._route_count},
                    headers={"Cache-Control": "private, no-store"},
                )
            return await asgi.fetch(self._application, request, self.env)
        from app_probe import app

        return await asgi.fetch(app, request, self.env)


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return await self.env.API_RUNTIME.getByName("compatibility").fetch(request)
