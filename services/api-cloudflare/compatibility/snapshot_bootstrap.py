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
    # Snapshot request-independent route declarations so a first profile visit
    # does not pay for workspace and moderation validation models. Discovery
    # execution imports stay deferred with their data and SDKs.
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
    ):
        importlib.import_module(module)
    return True
