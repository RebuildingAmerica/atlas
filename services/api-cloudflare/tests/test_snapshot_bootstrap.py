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


def test_snapshot_preloads_core_without_deferred_io_or_application_factory(tmp_path):
    (tmp_path / "python_modules").mkdir()
    archive = tmp_path / "python_modules/core.zip"
    with zipfile.ZipFile(archive, "w") as core:
        core.writestr("pydantic_core.py", "IMPORTED = True\n")
        core.writestr("fastapi.py", "import pydantic_core\nIMPORTED = True\n")
        core.writestr("httpx.py", "IMPORTED = True\n")
        core.writestr("atlas/__init__.py", "")
        core.writestr(
            "atlas/main.py",
            'raise AssertionError("Full API graph must load during a request")\n',
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
assert "atlas.main" not in sys.modules
print(json.dumps({"imported": pydantic_core.IMPORTED, "paths": sys.path.count(str(Path(sys.argv[2]) / "python_modules/core.zip")), "repeated": module.preload_core_packages()}))
"""
    output = subprocess.check_output(
        [sys.executable, "-c", script, str(PATH), str(tmp_path)],
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


def test_real_api_factory_module_import_does_not_construct_settings_or_app():
    script = """
import importlib.abc, sys
class RequestOnlyNative(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split(".")[0] in {"jwt", "cryptography", "_cffi_backend"}:
            raise AssertionError("Snapshot imported request-only native signing libraries")
sys.meta_path.insert(0, RequestOnlyNative())
from atlas.platform import config
def forbidden(*args, **kwargs):
    raise AssertionError("Snapshot must not read runtime settings")
config.get_settings = forbidden
config.Settings.__init__ = forbidden
import atlas.main
assert atlas.main._get_default_application.cache_info().currsize == 0
assert "probablepeople" not in sys.modules
assert "trafilatura" not in sys.modules
"""
    subprocess.check_call([sys.executable, "-c", script])
