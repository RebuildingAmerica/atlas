"""Snapshot imports exclude request configuration and deferred extraction data."""

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest


PATH = Path(__file__).parents[1] / "compatibility/snapshot_bootstrap.py"
CATALOG_MODULES = (
    "entries",
    "profiles",
    "public",
    "taxonomy",
    "atproto_identities",
    "feed",
    "org_annotations",
    "org_resources",
    "organization_atproto_identities",
)
ADDITIONAL_ROUTES = (
    "atlas.domains.access.api.health",
    "atlas.domains.access.api.lists",
    "atlas.domains.access.api.mcp_elicitations",
    "atlas.domains.access.api.org_usage",
    "atlas.domains.access.api.org_watch_digest",
    "atlas.domains.access.api.org_watches",
    "atlas.domains.access.api.service_status",
    "atlas.domains.access.api.verification",
    "atlas.domains.firehose",
    "atlas.domains.moderation.activity_api",
    "atlas.domains.moderation.api",
    "atlas.domains.moderation.merge_api",
    "atlas.domains.moderation.takedown_api",
    "atlas.platform.http.platform_router",
)


def test_snapshot_preloads_core_without_deferred_io_or_application_factory(tmp_path):
    (tmp_path / "python_modules").mkdir()
    archive = tmp_path / "python_modules/core.zip"
    with zipfile.ZipFile(archive, "w") as core:
        core.writestr("pydantic_core.py", "IMPORTED = True\n")
        core.writestr("fastapi.py", "import pydantic_core\nIMPORTED = True\n")
        core.writestr("httpx.py", "IMPORTED = True\n")
        modules = (
            tuple("atlas.domains.catalog.api." + name for name in CATALOG_MODULES)
            + ADDITIONAL_ROUTES
        )
        packages = set()
        for name in modules:
            parts = name.split(".")
            for size in range(1, len(parts)):
                packages.add("/".join(parts[:size]))
            core.writestr(name.replace(".", "/") + ".py", "IMPORTED = True\n")
        for package in sorted(packages):
            core.writestr(package + "/__init__.py", "")
        core.writestr(
            "atlas/main.py",
            'def create_app():\n    raise AssertionError("Snapshot constructed an application")\n',
        )
    (tmp_path / "core-identity.json").write_text(
        json.dumps(
            {
                "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            }
        )
    )
    script = """
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("snapshot_bootstrap", sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
module.__file__ = str(Path(sys.argv[2]) / "snapshot_bootstrap.py")
assert "atlas.main" not in sys.modules
assert module.preload_core_packages()
import pydantic_core
assert "fastapi" in sys.modules
assert "httpx" in sys.modules
assert "atlas.main" in sys.modules
for name in json.loads(sys.argv[3]):
    assert sys.modules[name].IMPORTED
print(json.dumps({"imported": pydantic_core.IMPORTED, "paths": sys.path.count(str(Path(sys.argv[2]) / "python_modules/core.zip")), "repeated": module.preload_core_packages()}))
"""
    output = subprocess.check_output(
        [
            sys.executable,
            "-c",
            script,
            str(PATH),
            str(tmp_path),
            json.dumps(modules),
        ],
        cwd=tmp_path,
        env={**os.environ, "PYTHONPATH": ""},
    )
    assert json.loads(output) == {"imported": True, "paths": 1, "repeated": True}


def test_snapshot_requires_matching_core_before_importing_application(
    tmp_path, monkeypatch
):
    spec = importlib.util.spec_from_file_location("snapshot_bootstrap", PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "__file__", str(tmp_path / "snapshot_bootstrap.py"))
    assert not module.preload_core_packages()
    (tmp_path / "core-identity.json").write_text(json.dumps({"sha256": "0" * 64}))
    with pytest.raises(RuntimeError, match="core archive"):
        module.preload_core_packages()
    (tmp_path / "python_modules").mkdir()
    (tmp_path / "python_modules/core.zip").write_bytes(b"wrong release")
    with pytest.raises(RuntimeError, match="release"):
        module.preload_core_packages()


def test_real_route_preload_does_not_construct_settings_services_or_app(tmp_path):
    (tmp_path / "python_modules").mkdir()
    archive = tmp_path / "python_modules/core.zip"
    with zipfile.ZipFile(archive, "w"):
        pass
    (tmp_path / "core-identity.json").write_text(
        json.dumps({"sha256": hashlib.sha256(archive.read_bytes()).hexdigest()})
    )
    script = """
import importlib.abc, importlib.util, sys
from pathlib import Path
class RequestOnlyServices(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split(".")[0] in {"mcp", "anthropic", "jwt", "cryptography", "_cffi_backend", "probablepeople", "trafilatura", "inflate64", "lxml", "pycrfsuite", "jiter", "rpds", "regex"}:
            raise AssertionError("Snapshot imported request-only services")
sys.meta_path.insert(0, RequestOnlyServices())
from atlas.platform import config
from atlas.platform import database
def forbidden(*args, **kwargs):
    raise AssertionError("Snapshot must not construct runtime settings or services")
config.get_settings = forbidden
config.Settings.__init__ = forbidden
database.get_db_connection = forbidden
spec = importlib.util.spec_from_file_location("snapshot_bootstrap", sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
module.__file__ = str(Path(sys.argv[2]) / "snapshot_bootstrap.py")
assert module.preload_core_packages()
routes = {}
for name, count in {"entries": 9, "profiles": 8, "public": 8, "taxonomy": 4,
        "atproto_identities": 5, "feed": 1, "org_annotations": 4,
        "org_resources": 12, "organization_atproto_identities": 6}.items():
    router = sys.modules['atlas.domains.catalog.api.' + name].router
    assert len(router.routes) == count
    routes[name] = router.routes
assert module.preload_core_packages()
for name, declared in routes.items():
    assert sys.modules['atlas.domains.catalog.api.' + name].router.routes is declared
atlas = sys.modules['atlas.main']
assert atlas._get_default_application.cache_info().currsize == 0
assert 'atlas.platform.http.router' not in sys.modules
for name in ('atlas.domains.access.api.health', 'atlas.domains.access.api.lists', 'atlas.domains.access.api.mcp_elicitations', 'atlas.domains.access.api.org_usage', 'atlas.domains.access.api.org_watch_digest', 'atlas.domains.access.api.org_watches', 'atlas.domains.access.api.service_status', 'atlas.domains.access.api.verification', 'atlas.domains.firehose', 'atlas.domains.moderation.activity_api', 'atlas.domains.moderation.api', 'atlas.domains.moderation.merge_api', 'atlas.domains.moderation.takedown_api', 'atlas.platform.http.platform_router'):
    assert name in sys.modules
assert 'atlas.domains.discovery.pipeline.runner' not in sys.modules
"""
    subprocess.check_call([sys.executable, "-c", script, str(PATH), str(tmp_path)])
