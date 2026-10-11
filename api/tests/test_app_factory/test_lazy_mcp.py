"""HTTP browsing keeps MCP optional without changing public exports or CORS."""

from __future__ import annotations

import importlib
import json
import subprocess
import sys

import pytest


def test_custom_transport_serves_public_http_without_importing_mcp_sdk() -> None:
    """A fresh application retains production auth and origin checks without MCP."""
    script = """
import asyncio, importlib.abc, json, logging, sys
class NoMcpSdk(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split(".")[0] in {"mcp", "anthropic", "jwt", "cryptography"}:
            raise AssertionError("HTTP browsing imported a request-only SDK")
sys.meta_path.insert(0, NoMcpSdk())
import httpx
from starlette.responses import JSONResponse
from atlas.main import create_app
from atlas.platform.config import Settings
from atlas.platform.hosted_runtime import HostedRuntime, bind_hosted_runtime
logging.disable(logging.CRITICAL)
settings = Settings(_env_file=None, environment="production", multi_user=True,
    managed=True, database_url="sqlite:///unused.sqlite",
    cors_origins=["https://reader.example.com"],
    auth_jwt_issuer="https://atlas.example.com",
    auth_jwt_audience=["https://atlas.example.com/mcp", "https://api.example.com/api"],
    auth_internal_secret="fake-internal-secret",
    auth_api_key_introspection_url="https://atlas.example.com/api/auth/api-key/verify",
    auth_membership_verification_url="https://atlas.example.com/api/auth/membership")
async def no_database(*args, **kwargs):
    raise AssertionError("This browsing check must not need a database")
async def custom(scope, receive, send):
    await JSONResponse({"custom": True})(scope, receive, send)
async def main():
    with bind_hosted_runtime(HostedRuntime(settings, no_database)):
        app = create_app(mcp_asgi_app=custom)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                base_url="https://api.example.com") as client:
            assert (await client.get("/health")).json() == {"status": "ok"}
            assert (await client.get("/api/lists")).status_code == 401
            assert (await client.post("/mcp")).json() == {"custom": True}
            origins = {}
            for origin in ["https://reader.example.com", "https://atlas.example.com",
                    "https://api.example.com", "http://localhost:54321", "https://evil.example.com"]:
                response = await client.options("/health", headers={"Origin": origin,
                    "Access-Control-Request-Method": "GET"})
                origins[origin] = response.headers.get("access-control-allow-origin")
            assert "mcp" not in sys.modules
            assert "atlas.platform.mcp.server" not in sys.modules
            print(json.dumps(origins))
asyncio.run(main())
"""
    output = subprocess.check_output([sys.executable, "-c", script], text=True)
    assert json.loads(output.splitlines()[-1]) == {
        "https://reader.example.com": "https://reader.example.com",
        "https://atlas.example.com": "https://atlas.example.com",
        "https://api.example.com": "https://api.example.com",
        "http://localhost:54321": None,
        "https://evil.example.com": None,
    }


def test_package_exports_retain_values_identity_and_introspection() -> None:
    """Lazy package access resolves the same public objects as direct modules."""
    package = importlib.import_module("atlas.platform.mcp")
    exports = {
        "data": ["AtlasDataService"],
        "resources": [
            "ATLAS_RESOURCE_TEMPLATE_URIS",
            "DISCOVERY_RUN_BRIEF_MIME_TYPE",
            "install_data_resources",
        ],
        "server": ["build_mcp", "get_mcp", "get_mcp_asgi_app", "mcp_session_lifespan"],
        "server_transport": ["build_transport_security_settings", "split_cors_origins"],
    }
    for module_name, names in exports.items():
        module = importlib.import_module(f"atlas.platform.mcp.{module_name}")
        for name in names:
            assert getattr(package, name) is getattr(module, name)
    assert set(package.__all__) <= set(dir(package))
    with pytest.raises(AttributeError, match="missing_export"):
        _ = package.missing_export


def test_default_server_access_and_explicit_transport_remain_available() -> None:
    """The ordinary app keeps its singleton and request-owned transport surface."""
    from atlas import main
    from atlas.platform.mcp.server import build_mcp, get_mcp

    assert main.get_mcp() is get_mcp()
    assert callable(main.get_mcp_asgi_app(server=build_mcp()))
