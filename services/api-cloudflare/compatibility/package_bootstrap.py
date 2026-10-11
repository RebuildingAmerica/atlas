"""Load the immutable pure-package archive without adding it to Worker code size."""

import asyncio
import hashlib
import json
import sys
import shutil
import zipfile
from pathlib import Path

_archive_task = None


def _extract_resource_packages(archive, expected):
    # probablepeople uses filesystem-relative CRF model paths. Extract only
    # this immutable pure package; native extensions stay provider-bundled.
    root = Path("/tmp") / f"atlas-resources-{expected}"
    try:
        with zipfile.ZipFile(archive) as source:
            members = [
                info
                for info in source.infolist()
                if not info.is_dir() and info.filename.startswith("probablepeople/")
            ]
            if not members:
                return None
            for info in members:
                parts = info.filename.split("/")
                if any(part in {"", ".", ".."} for part in parts) or "\\" in info.filename:
                    raise RuntimeError("Invalid deferred resource path.")
                if (info.external_attr >> 16) & 0o170000 == 0o120000:
                    raise RuntimeError("Deferred resources cannot contain symbolic links.")
                target = root.joinpath(*parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.open(info) as incoming, target.open("wb") as outgoing:
                    shutil.copyfileobj(incoming, outgoing, length=64 * 1024)
        return root
    except BaseException:
        shutil.rmtree(root, ignore_errors=True)
        raise


async def _load_package_archive(env):
    root = Path(__file__).parent
    identity = root / "package-identity.json"
    if identity.is_file():
        expected = json.loads(identity.read_text())["sha256"]
        response = await env.PACKAGE_ASSETS.fetch("https://packages.invalid/packages.zip")
        if response.status != 200:
            raise RuntimeError("Immutable runtime package asset is unavailable.")
        archive = Path("/tmp") / f"atlas-packages-{expected}.zip"
        reader = response.body.getReader()
        try:
            # Avoid retaining JavaScript, Python, and filesystem copies of the
            # full archive so people can open profiles within the Free memory limit.
            with archive.open("wb") as file:
                while True:
                    chunk = await reader.read()
                    if chunk.done:
                        break
                    chunk.value.to_file(file)
            with archive.open("rb") as file:
                actual = hashlib.file_digest(file, "sha256").hexdigest()
            if actual != expected:
                raise RuntimeError("Runtime package asset does not match its release.")
        except BaseException:
            archive.unlink(missing_ok=True)
            await reader.cancel()
            raise
        finally:
            reader.releaseLock()
        resources = _extract_resource_packages(archive, expected)
        sys.path.insert(0, str(archive))
        if resources is not None:
            sys.path.insert(0, str(resources))
    else:
        # The small compatibility bundle has no package archive or asset binding.
        archive = root / "python_modules/packages.zip"
        if archive.is_file():
            sys.path.insert(0, str(archive))


async def ensure_package_archive(env):
    global _archive_task
    if _archive_task is None:
        _archive_task = asyncio.create_task(_load_package_archive(env))
    await _archive_task
