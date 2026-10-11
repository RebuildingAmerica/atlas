"""Snapshot importable code, leaving settings and services owned by requests."""

import hashlib
import importlib
import json
import sys
from pathlib import Path


def preload_core_packages():
    root = Path(__file__).parent
    identity = root / "core-identity.json"
    archive = root / "python_modules/core.zip"
    if not identity.is_file() and not archive.is_file():
        # The independent small compatibility probe has no full API packages.
        return False
    if not archive.is_file():
        raise RuntimeError("The bundled API core archive is required.")
    expected = json.loads(identity.read_text())["sha256"]
    with archive.open("rb") as file:
        actual = hashlib.file_digest(file, "sha256").hexdigest()
    if actual != expected:
        raise RuntimeError("Bundled API core does not match its release.")
    if str(archive) not in sys.path:
        sys.path.insert(0, str(archive))
    # Snapshot the API's code so visits after eviction avoid the full import
    # cost. Its lazy factory reads no settings and constructs no application.
    # JWT signing libraries remain request-only: native cryptography left
    # deployment initialization unsettled when explicitly preloaded.
    for module in ("pydantic_core", "fastapi", "httpx", "atlas.main"):
        importlib.import_module(module)
    return True
