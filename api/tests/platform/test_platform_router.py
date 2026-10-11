"""The platform admin gets its own OpenAPI document, written next to the public one."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from atlas.platform.http import platform_router

if TYPE_CHECKING:
    from pathlib import Path

    import pytest


def test_writes_the_platform_document_to_the_openapi_folder(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    fake_module = tmp_path / "api" / "atlas" / "platform" / "http" / "platform_router.py"
    monkeypatch.setattr(platform_router, "__file__", str(fake_module))

    platform_router.main()

    written = tmp_path / "openapi" / "atlas-platform.openapi.json"
    document = json.loads(written.read_text(encoding="utf-8"))
    assert document["info"]["title"] == "Atlas platform API"
    assert "/api/platform/cloud-costs" in document["paths"]
    assert str(written) in capsys.readouterr().out
