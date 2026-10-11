"""Concurrent API requests load only their exact immutable release package asset."""

import asyncio
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

SPEC = importlib.util.spec_from_file_location(
    "package_bootstrap",
    Path(__file__).parents[1] / "compatibility/package_bootstrap.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


@pytest.mark.asyncio
async def test_concurrent_package_loading_verifies_once_and_rejects_mismatched_data(
    tmp_path, monkeypatch
):
    data = b"immutable zip fixture"
    digest = hashlib.sha256(data).hexdigest()
    identity = tmp_path / "package-identity.json"
    identity.write_text(json.dumps({"sha256": digest}))
    monkeypatch.setattr(MODULE, "__file__", str(tmp_path / "package_bootstrap.py"))
    monkeypatch.setattr(MODULE, "_archive_task", None)
    response = SimpleNamespace(
        status=200,
        arrayBuffer=AsyncMock(return_value=SimpleNamespace(to_bytes=lambda: data)),
    )
    fetch = AsyncMock(return_value=response)
    env = SimpleNamespace(PACKAGE_ASSETS=SimpleNamespace(fetch=fetch))
    archive = Path("/tmp") / f"atlas-packages-{digest}.zip"
    original_path = sys.path.copy()
    try:
        await asyncio.gather(*(MODULE.ensure_package_archive(env) for _ in range(12)))
        assert archive.read_bytes() == data
        assert sys.path.count(str(archive)) == 1
        fetch.assert_awaited_once_with("https://packages.invalid/packages.zip")
        monkeypatch.setattr(MODULE, "_archive_task", None)
        identity.write_text(json.dumps({"sha256": "0" * 64}))
        with pytest.raises(RuntimeError, match="does not match"):
            await MODULE.ensure_package_archive(env)
    finally:
        sys.path[:] = original_path
        archive.unlink(missing_ok=True)
