"""Load the immutable pure-package archive without adding it to Worker code size."""

import asyncio
import hashlib
import json
import sys
from pathlib import Path

_archive_task = None


async def _load_package_archive(env):
    root = Path(__file__).parent
    identity = root / "package-identity.json"
    if identity.is_file():
        expected = json.loads(identity.read_text())["sha256"]
        response = await env.PACKAGE_ASSETS.fetch(
            "https://packages.invalid/packages.zip"
        )
        if response.status != 200:
            raise RuntimeError("Immutable runtime package asset is unavailable.")
        data = await response.bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise RuntimeError("Runtime package asset does not match its release.")
        archive = Path("/tmp") / f"atlas-packages-{expected}.zip"
        archive.write_bytes(data)
        sys.path.insert(0, str(archive))
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
