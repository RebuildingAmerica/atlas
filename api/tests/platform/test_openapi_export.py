"""Tests for OpenAPI schema export and CLI helpers."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import atlas.platform.openapi as openapi_module
from atlas.platform.openapi import export_openapi_schema, generate_operation_id, main


class TestGenerateOperationId:
    """Tests for the generate_operation_id helper."""

    def test_returns_route_name(self) -> None:
        """Operation IDs should match the route function name."""
        route = MagicMock()
        route.name = "listEntities"
        assert generate_operation_id(route) == "listEntities"

    def test_different_route_names(self) -> None:
        """Each route should produce a unique operation ID from its name."""
        for name in ("getEntity", "createDiscoveryRun", "health_check"):
            route = MagicMock()
            route.name = name
            assert generate_operation_id(route) == name


class TestExportOpenapiSchema:
    """Tests for the export_openapi_schema function."""

    def test_writes_json_to_path(self) -> None:
        """The schema should be written as deterministic JSON to the given path."""
        mock_app = MagicMock()
        mock_app.openapi.return_value = {
            "openapi": "3.1.0",
            "info": {"title": "Atlas REST API", "version": "1.0.0"},
            "paths": {},
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "openapi" / "atlas.openapi.json"
            result = export_openapi_schema(mock_app, output_path)

            assert result == output_path
            assert output_path.exists()

            content = output_path.read_text(encoding="utf-8")
            parsed = json.loads(content)
            assert parsed["info"]["title"] == "Atlas REST API"
            # Keys should be sorted
            keys = list(parsed.keys())
            assert keys == sorted(keys)
            # File should end with newline
            assert content.endswith("\n")

    def test_creates_parent_directories(self) -> None:
        """Missing parent directories should be created automatically."""
        mock_app = MagicMock()
        mock_app.openapi.return_value = {"openapi": "3.1.0"}

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "deep" / "nested" / "schema.json"
            export_openapi_schema(mock_app, output_path)
            assert output_path.exists()


class TestMain:
    """Tests for the CLI entrypoint."""

    def test_main_exports_schema_and_prints_path(self, capsys: object) -> None:
        """The main function should create an app, export the schema, and print the path."""
        mock_app = MagicMock()
        mock_app.openapi.return_value = {"openapi": "3.1.0", "info": {"title": "Test"}}

        mock_module = MagicMock()
        mock_module.create_app.return_value = mock_app

        with tempfile.TemporaryDirectory() as tmpdir:
            fake_file = str(Path(tmpdir) / "atlas" / "platform" / "openapi.py")
            expected = Path(tmpdir) / "openapi" / "atlas.openapi.json"

            with (
                patch.object(openapi_module, "__file__", fake_file),
                patch(
                    "atlas.platform.openapi.importlib.import_module",
                    return_value=mock_module,
                ),
            ):
                main()

            mock_module.create_app.assert_called_once()
            assert expected.exists()

            captured = capsys.readouterr()
            assert str(expected) in captured.out
