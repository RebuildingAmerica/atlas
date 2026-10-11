"""Dispatch protected compatibility checks after loading immutable package assets."""

from urllib.parse import urlsplit

from package_bootstrap import ensure_package_archive
from runtime_probe import RuntimeProbe
from snapshot_bootstrap import preload_core_packages
from workers import DurableObject, Response, WorkerEntrypoint, asgi

preload_core_packages()


class ApiRuntime(DurableObject):
    def _discovery_inline_enabled(self):
        if not hasattr(self, "_discovery_inline"):
            from hosted_application import _settings

            try:
                # Use the same explicit, typed production configuration as the
                # application; bool("false") would incorrectly load assets.
                self._discovery_inline = _settings(self.env).discovery_inline
            except Exception:
                raise RuntimeError("Invalid hosted API configuration.") from None
        return self._discovery_inline

    def _firehose_adapter(self):
        if not hasattr(self, "_firehose"):
            from hosted_jobs import create_firehose_alarm

            self._firehose = create_firehose_alarm(self.env, self.ctx.storage)
        return self._firehose

    async def alarm(self):
        from timer_cleanup import install_timer_cleanup

        # Retain a rescue alarm even when package loading fails before the
        # adapter can arm its own database/lease recovery alarm.
        from time import time

        await self.ctx.storage.setAlarm(int(time() * 1000) + 60_000)
        if not install_timer_cleanup():
            raise RuntimeError("The selected hosted loop could not be adapted.")
        await ensure_package_archive(self.env)
        await self._firehose_adapter().alarm()

    async def fetch(self, request):
        path = urlsplit(request.url).path
        if not hasattr(self, "_diagnostics"):
            self._diagnostics = RuntimeProbe()
        self._diagnostics.begin_request()
        if path == "/runtime-state":
            return Response.json(
                self._diagnostics.snapshot(
                    application_cached=hasattr(self, "_application")
                ),
                headers={"Cache-Control": "private, no-store"},
            )
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
        application_request = (
            path == "/imports" or path == "/atlas" or path.startswith("/atlas/")
        )
        # Profile browsing needs only bundled core code. Inline REST/MCP
        # discovery retains all extraction resources before ASGI dispatch.
        if path == "/native" or (
            application_request and self._discovery_inline_enabled()
        ):
            with self._diagnostics.measure("packages"):
                await ensure_package_archive(self.env)
        if application_request:
            if not hasattr(self, "_application"):
                with self._diagnostics.measure("application"):
                    from hosted_application import create_hosted_application

                    self._application, self._route_count = create_hosted_application(
                        self.env,
                        strip_evaluation_prefix=True,
                        firehose_wake=self._firehose_adapter(),
                    )
            if path == "/imports":
                return Response.json(
                    {
                        "status": "ok",
                        "routes": self._route_count,
                        "diagnostics": self._diagnostics.snapshot(
                            application_cached=True
                        ),
                    },
                    headers={"Cache-Control": "private, no-store"},
                )
            return await asgi.fetch(self._application, request, self.env)
        from app_probe import app

        return await asgi.fetch(app, request, self.env)


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return await self.env.API_RUNTIME.getByName("compatibility").fetch(request)
