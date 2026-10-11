"""Serve Atlas's original API with request-owned services and paused consumers.

The web and protected operations edges select the named application object.
Direct Worker traffic is rejected so every API visit uses those access controls.
"""

from urllib.parse import unquote, urlsplit

from consumer_control import ConsumerControl, release_identity
from package_bootstrap import ensure_package_archive
from snapshot_bootstrap import preload_core_packages
from workers import DurableObject, Response, WorkerEntrypoint, asgi

preload_core_packages()


class _DiscoveryWake:
    """Resolve the sibling only when enqueuing, allowing a paused bootstrap."""

    def __init__(self, env):
        self.env = env

    def _owner(self):
        binding = getattr(self.env, "DISCOVERY_RUNTIME", None)
        if binding is None:
            raise RuntimeError("Discovery runtime binding is required.")
        return binding.getByName("application")

    async def prepare_wake(self, receipt):
        return await self._owner().prepare_wake(receipt)

    async def confirm_wake(self, receipt=None):
        return await self._owner().confirm_wake(receipt)

    async def abort_wake(self, receipt):
        return await self._owner().abort_wake(receipt)


class ApiRuntime(DurableObject):
    def _consumer_control(self):
        if not hasattr(self, "_consumers"):
            self._consumers = ConsumerControl(self.env, self.ctx.storage)
        return self._consumers

    def _firehose_adapter(self):
        if not hasattr(self, "_firehose"):
            from hosted_jobs import create_firehose_alarm

            self._firehose = create_firehose_alarm(
                self.env, self._consumer_control().gated_storage
            )
        return self._firehose

    # Sibling discovery publications retain wake receipts even while paused.
    async def prepare_wake(self, receipt):
        return await self._firehose_adapter().prepare_wake(receipt)

    async def confirm_wake(self, receipt=None):
        return await self._firehose_adapter().confirm_wake(receipt)

    async def abort_wake(self, receipt):
        return await self._firehose_adapter().abort_wake(receipt)

    def _install_timer_cleanup(self):
        from timer_cleanup import install_timer_cleanup

        if not install_timer_cleanup():
            raise RuntimeError("The selected hosted loop could not be adapted.")

    async def _alarm_unit(self):
        self._install_timer_cleanup()
        # Delivery materializes stored observations with core CRUD only.
        # Loading extraction models here would evict the browsing app cache.
        return await self._firehose_adapter().alarm()

    async def alarm(self):
        # The gate checks durable state before constructing services or opening SQL.
        return await self._consumer_control().run_alarm(self._alarm_unit)

    async def fetch(self, request):
        path = urlsplit(request.url).path
        if path == "/__atlas/release":
            if request.method != "GET":
                return Response.json({"error": "Method not allowed"}, status=405)
            return Response.json(
                release_identity(self.env, "api"),
                headers={"Cache-Control": "private, no-store"},
            )
        if path == "/__atlas/consumers":
            return await self._consumer_control().handle_request(request)

        self._install_timer_cleanup()
        if (
            request.method == "POST"
            and unquote(path).rstrip("/") in {"/api/discovery-runs", "/mcp"}
            and self._consumer_control().settings.discovery_inline
        ):
            # Ordinary browsing needs only core packages. Inline extraction
            # still receives the identical verified models and resources.
            await ensure_package_archive(self.env)
        if not hasattr(self, "_application"):
            from hosted_application import create_hosted_application

            self._application, _ = create_hosted_application(
                self.env,
                strip_evaluation_prefix=False,
                firehose_wake=self._firehose_adapter(),
                discovery_wake=_DiscoveryWake(self.env),
            )
        return await asgi.fetch(self._application, request, self.env)


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return Response("Forbidden", status=403)
