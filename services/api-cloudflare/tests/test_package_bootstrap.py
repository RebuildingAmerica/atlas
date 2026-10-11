"""Concurrent API requests load only their exact immutable release package asset."""

import asyncio
import hashlib
import importlib.util
import json
import io
import zipfile
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


class AssetReader:
    def __init__(self, data):
        self.chunks = iter(data[index : index + 4] for index in range(0, len(data), 4))
        self.released = False
        self.cancel = AsyncMock()

    async def read(self):
        chunk = next(self.chunks, None)
        return SimpleNamespace(
            done=chunk is None,
            value=SimpleNamespace(to_file=lambda file: file.write(chunk)),
        )

    def releaseLock(self):
        self.released = True


@pytest.mark.asyncio
async def test_concurrent_package_loading_verifies_once_and_rejects_mismatched_data(
    tmp_path, monkeypatch
):
    fixture = io.BytesIO()
    with zipfile.ZipFile(fixture, "w") as target:
        target.writestr("babel/data.txt", b"immutable zip fixture")
    data = fixture.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    identity = tmp_path / "package-identity.json"
    identity.write_text(json.dumps({"sha256": digest}))
    monkeypatch.setattr(MODULE, "__file__", str(tmp_path / "package_bootstrap.py"))
    monkeypatch.setattr(MODULE, "_archive_task", None)
    readers = []

    def reader():
        stream = AssetReader(data)
        readers.append(stream)
        return stream

    response = SimpleNamespace(
        status=200,
        bytes=AsyncMock(return_value=data),
        body=SimpleNamespace(getReader=reader),
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
        response.bytes.assert_not_awaited()
        assert readers[0].released
        monkeypatch.setattr(MODULE, "_archive_task", None)
        identity.write_text(json.dumps({"sha256": "0" * 64}))
        with pytest.raises(RuntimeError, match="does not match"):
            await MODULE.ensure_package_archive(env)
        assert readers[1].released
        assert not (Path("/tmp") / f"atlas-packages-{'0' * 64}.zip").exists()
    finally:
        sys.path[:] = original_path
        archive.unlink(missing_ok=True)


@pytest.mark.asyncio
async def test_model_files_are_available_beside_imported_package_after_verified_asset_load(
    tmp_path, monkeypatch
):
    fixture = io.BytesIO()
    with zipfile.ZipFile(fixture, "w") as target:
        target.writestr("probablepeople/__init__.py", "")
        target.writestr("probablepeople/model.crfsuite", b"trained-model-exact-bytes")
        target.writestr("babel/data.txt", b"other-deferred-resource")
    data = fixture.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    (tmp_path / "package-identity.json").write_text(json.dumps({"sha256": digest}))
    monkeypatch.setattr(MODULE, "__file__", str(tmp_path / "package_bootstrap.py"))
    monkeypatch.setattr(MODULE, "_archive_task", None)
    stream = AssetReader(data)
    response = SimpleNamespace(status=200, body=SimpleNamespace(getReader=lambda: stream))
    env = SimpleNamespace(PACKAGE_ASSETS=SimpleNamespace(fetch=AsyncMock(return_value=response)))
    original_path = sys.path.copy()
    try:
        await MODULE.ensure_package_archive(env)
        root = Path("/tmp") / f"atlas-resources-{digest}"
        assert (root / "probablepeople/model.crfsuite").read_bytes() == b"trained-model-exact-bytes"
        assert not (root / "babel").exists()
        assert sys.path.index(str(root)) < sys.path.index(
            str(Path("/tmp") / f"atlas-packages-{digest}.zip")
        )
        assert stream.released
    finally:
        import shutil

        sys.path[:] = original_path
        (Path("/tmp") / f"atlas-packages-{digest}.zip").unlink(missing_ok=True)
        shutil.rmtree(Path("/tmp") / f"atlas-resources-{digest}", ignore_errors=True)


@pytest.mark.parametrize(
    "name,mode",
    [
        ("probablepeople/../outside", 0o100644),
        ("probablepeople/linked-model", 0o120777),
    ],
)
def test_resource_extraction_rejects_unsafe_members_and_removes_partial_files(tmp_path, name, mode):
    archive = tmp_path / "resources.zip"
    with zipfile.ZipFile(archive, "w") as target:
        target.writestr("probablepeople/first-model", b"partial")
        info = zipfile.ZipInfo(name)
        info.external_attr = mode << 16
        target.writestr(info, b"unsafe")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    with pytest.raises(RuntimeError, match="resource|symbolic"):
        MODULE._extract_resource_packages(archive, digest)
    assert not (Path("/tmp") / f"atlas-resources-{digest}").exists()
