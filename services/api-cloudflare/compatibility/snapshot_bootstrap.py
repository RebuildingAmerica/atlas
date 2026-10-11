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
    # Preload catalog route declarations to reduce cold profile response time.
    # Settings, application construction, discovery execution, MCP, model SDKs,
    # and native signing services remain owned by actual requests.
    for module in (
        "pydantic_core",
        "fastapi",
        "httpx",
        "atlas.main",
        "atlas.domains.catalog.api.entries",
        "atlas.domains.catalog.api.profiles",
        "atlas.domains.catalog.api.public",
        "atlas.domains.catalog.api.taxonomy",
        "atlas.domains.catalog.api.atproto_identities",
        "atlas.domains.catalog.api.feed",
        "atlas.domains.catalog.api.org_annotations",
        "atlas.domains.catalog.api.org_resources",
        "atlas.domains.catalog.api.organization_atproto_identities",
    ):
        importlib.import_module(module)
    return True
