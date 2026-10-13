"""Consume the hosted search lane in explicitly enabled durable alarm turns."""

from urllib.parse import urlsplit

from consumer_control import ConsumerControl, release_identity
from package_bootstrap import ensure_package_archive
from snapshot_bootstrap import preload_core_packages
from workers import DurableObject, Response, WorkerEntrypoint

preload_core_packages()


class _FirehoseWake:
    """Resolve the API sibling only when publication creates an observation."""

    def __init__(self, env):
        self.env = env

    def _owner(self):
        binding = getattr(self.env, "API_RUNTIME", None)
        if binding is None:
            raise RuntimeError("API runtime binding is required.")
        return binding.getByName("application")

    async def prepare_wake(self, receipt):
        return await self._owner().prepare_wake(receipt)

    async def confirm_wake(self, receipt=None):
        return await self._owner().confirm_wake(receipt)

    async def abort_wake(self, receipt):
        return await self._owner().abort_wake(receipt)


def create_discovery_alarm(env, storage):
    """Construct services without opening SQL or starting a process worker."""
    from dns_transport import workers_dns_txt_lookup
    from hosted_application import _hyperdrive_parameters, _settings, connect_database
    from http_transport import workers_http_transport_factory
    from public_source_transport import workers_public_source_fetch

    from atlas.domains.discovery.hosted_jobs import DiscoveryAlarmAdapter
    from atlas.platform.hosted_runtime import HostedRuntime

    try:
        settings = _settings(env)
        transport_factory = workers_http_transport_factory(env)
        _hyperdrive_parameters(env)
    except Exception:
        raise RuntimeError("Invalid hosted API configuration.") from None

    async def connect(database_url, *, backend=None):
        if database_url != settings.database_url or backend not in (None, "postgres"):
            raise RuntimeError("Hosted database configuration mismatch.")
        return await connect_database(**_hyperdrive_parameters(env))

    return DiscoveryAlarmAdapter(
        runtime=HostedRuntime(
            settings,
            connect,
            firehose_wake=_FirehoseWake(env),
            public_source_fetch=workers_public_source_fetch,
            dns_txt_lookup=workers_dns_txt_lookup,
            http_transport_factory=transport_factory,
        ),
        storage=storage,
    )


class DiscoveryRuntime(DurableObject):
    def _consumer_control(self):
        if not hasattr(self, "_consumers"):
            self._consumers = ConsumerControl(self.env, self.ctx.storage)
        return self._consumers

    def _discovery_adapter(self):
        if not hasattr(self, "_discovery"):
            self._discovery = create_discovery_alarm(
                self.env, self._consumer_control().gated_storage
            )
        return self._discovery

    async def prepare_wake(self, receipt):
        return await self._discovery_adapter().prepare_wake(receipt)

    async def confirm_wake(self, receipt=None):
        return await self._discovery_adapter().confirm_wake(receipt)

    async def abort_wake(self, receipt):
        return await self._discovery_adapter().abort_wake(receipt)

    async def _alarm_unit(self):
        from timer_cleanup import install_timer_cleanup

        if not install_timer_cleanup():
            raise RuntimeError("The selected hosted loop could not be adapted.")
        await ensure_package_archive(self.env)
        return await self._discovery_adapter().alarm()

    async def alarm(self):
        return await self._consumer_control().run_alarm(self._alarm_unit)

    async def fetch(self, request):
        path = urlsplit(request.url).path
        if path == "/__atlas/consumers":
            return await self._consumer_control().handle_request(request)
        if path in {"/__atlas/release", "/health"}:
            if request.method != "GET":
                return Response.json({"error": "Method not allowed"}, status=405)
            identity = release_identity(self.env, "discovery")
            return Response.json(
                identity if path == "/__atlas/release" else {"status": "ok"},
                headers={"Cache-Control": "private, no-store"},
            )
        return Response("Not found", status=404)


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return Response("Forbidden", status=403)
