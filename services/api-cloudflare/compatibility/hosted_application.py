"""Serve existing Atlas routes with production auth and request-owned services."""

import json
from contextlib import AsyncExitStack, asynccontextmanager
from functools import wraps
from inspect import signature

from atlas.platform.config import Settings, get_settings, validate_runtime_auth_config
from atlas.platform.hosted_runtime import HostedRuntime, bind_hosted_runtime
from database_adapter import connect_database
from hosted_jwks import HostedJwksCache
from public_source_transport import workers_public_source_fetch


class ExplicitSettings(Settings):
    """Read only explicit Worker configuration, never a process env or .env file."""

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls,
        init_settings,
        env_settings,
        dotenv_settings,
        file_secret_settings,
    ):
        return (init_settings,)


def _settings(env):
    raw = json.loads(env.ATLAS_API_SETTINGS)
    if not isinstance(raw, dict) or any(not isinstance(key, str) for key in raw):
        raise ValueError("Settings must be an object")
    retired = {
        "ATLAS_AUTH_INTERNAL_SECRET",
        "AUTH_INTERNAL_SECRET",
        "ATLAS_OPERATOR_ALLOWED_EMAILS",
        "OPERATOR_ALLOWED_EMAILS",
    }
    if any(key.upper() in retired for key in raw):
        raise ValueError("Retired authority configuration is forbidden")
    names = {}
    for name, field in Settings.model_fields.items():
        names[name.upper()] = name
        if isinstance(field.validation_alias, str):
            names[field.validation_alias.upper()] = name
    values = {}
    for key, value in raw.items():
        name = names.get(key.upper())
        if name is None:
            # Original process configuration can contain non-Settings entries.
            continue
        if name in values and values[name] != value:
            raise ValueError("Conflicting settings aliases")
        values[name] = value
    if isinstance(values.get("cors_origins"), str):
        values["cors_origins"] = json.loads(values["cors_origins"])
    if not isinstance(values.get("cors_origins"), list) or not values["cors_origins"]:
        raise ValueError("Explicit CORS origins are required")
    settings = ExplicitSettings(_env_file=None, **values)
    if settings.environment != "production" or settings.database_backend != "postgres":
        raise ValueError("Production PostgreSQL settings are required")
    if not settings.multi_user:
        raise ValueError("Hosted authentication must be enabled")
    validate_runtime_auth_config(settings)
    return settings


def _hyperdrive_parameters(env):
    binding = env.HYPERDRIVE
    parameters = {
        name: getattr(binding, name)
        for name in ("host", "user", "password", "database")
    }
    if any(not isinstance(value, str) or not value for value in parameters.values()):
        raise ValueError("Hyperdrive binding is incomplete")
    if isinstance(binding.port, bool):
        raise ValueError("Hyperdrive port is invalid")
    port = int(binding.port)
    if not 1 <= port <= 65535:
        raise ValueError("Hyperdrive port is invalid")
    return {**parameters, "port": port}


@asynccontextmanager
async def _http_lifespan(_app):
    # Migrations and durable pollers have separate deployment/worker lifecycles.
    # Browsing a profile or opening MCP must never launch them implicitly.
    yield


async def _request_mcp(scope, receive, send):
    from atlas.platform.mcp.server import build_mcp, get_mcp_asgi_app

    server = build_mcp()
    transport = get_mcp_asgi_app(server=server, include_bearer_auth=False)
    async with server.session_manager.run():
        await transport(scope, receive, send)


def _install_async_dependencies(app):
    from atlas.domains.catalog.api.org_resources_support import (
        get_directory_domain_verifier,
    )
    from atlas.domains.catalog.api.profile_claim_helpers import get_profile_claim_policy
    from atlas.domains.firehose.http import (
        firehose_http_context,
        firehose_json_http_context,
    )

    def adapt(call):
        @wraps(call)
        async def dependency(*args, **kwargs):
            return call(*args, **kwargs)

        # Resolve annotations in the original module so FastAPI retains Header
        # aliases, nested dependencies, and validation when inspecting a wrapper.
        dependency.__signature__ = signature(call, eval_str=True)
        return dependency

    # These explicit dependencies only read request configuration, validate
    # headers, or construct services; none performs blocking I/O. Keeping them
    # async preserves claims, directory verification, and Firehose without a
    # thread pool or changing the ordinary Node/self-hosted application.
    for call in (
        get_settings,
        get_directory_domain_verifier,
        get_profile_claim_policy,
        firehose_http_context,
        firehose_json_http_context,
    ):
        app.dependency_overrides[call] = adapt(call)


def create_hosted_application(
    env, *, strip_evaluation_prefix=False, firehose_wake=None, discovery_wake=None
):
    """Return an ASGI callable and route count for one caller-owned DO cache.

    Configuration and routes are stable for this instance. Every ASGI invocation
    allocates a separate connector and runtime; no visitor or open connection is
    cached. The optional `/atlas` alias is only for protected hosted evaluation.
    """
    try:
        settings = _settings(env)
        _hyperdrive_parameters(env)

        async def no_factory_connection(_url, *, backend=None):
            raise RuntimeError("Database access requires a hosted request")

        with bind_hosted_runtime(
            HostedRuntime(
                settings,
                no_factory_connection,
                firehose_wake,
                workers_public_source_fetch,
                discovery_wake=discovery_wake,
            )
        ):
            # atlas.main also constructs its ordinary server at import. Bind
            # explicit settings before importing; never populate os.environ.
            from atlas.main import create_app
            from atlas.platform.mcp.auth_middleware import McpBearerAuthMiddleware

            app = create_app(
                lifespan_override=_http_lifespan,
                # Reject unauthenticated probes before tool registration can
                # block visitors searching profiles on the same event loop.
                # The guard still owns scopes, claims, body replay and usage;
                # each accepted request owns its server and session manager.
                mcp_asgi_app=McpBearerAuthMiddleware(_request_mcp),
            )

        _install_async_dependencies(app)
    except Exception:
        # Pydantic/URL errors can include entire secret-bearing input values.
        raise RuntimeError("Invalid hosted API configuration.") from None

    keys = HostedJwksCache(settings)

    async def hosted(scope, receive, send):
        connections = AsyncExitStack()

        async def connect(database_url, *, backend=None):
            if database_url != settings.database_url or backend not in (
                None,
                "postgres",
            ):
                raise RuntimeError("Hosted database configuration mismatch.")
            connection = await connect_database(**_hyperdrive_parameters(env))
            connections.push_async_callback(connection.close)
            return connection

        if strip_evaluation_prefix:
            path = scope.get("path", "")
            if path == "/atlas" or path.startswith("/atlas/"):
                scope = dict(scope)
                scope["path"] = path[len("/atlas") :] or "/"
                raw_path = scope.get("raw_path", b"")
                if raw_path == b"/atlas" or raw_path.startswith(b"/atlas/"):
                    scope["raw_path"] = raw_path[len(b"/atlas") :] or b"/"
        with bind_hosted_runtime(
            HostedRuntime(
                settings,
                connect,
                firehose_wake,
                workers_public_source_fetch,
                discovery_wake=discovery_wake,
                jwks_documents=await keys.for_headers(scope.get("headers", [])),
            )
        ):
            try:
                await app(scope, receive, send)
            except BaseException as request_error:
                try:
                    await connections.aclose()
                except BaseException as cleanup_error:
                    # Finish every cleanup callback without turning a canceled
                    # request into an ordinary failure. Retain cleanup evidence.
                    raise request_error from cleanup_error
                raise
            else:
                await connections.aclose()

    return hosted, len(app.routes)
