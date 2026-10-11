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
