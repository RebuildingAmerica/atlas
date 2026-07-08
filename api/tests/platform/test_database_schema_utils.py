"""Tests for database utility helpers."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

from atlas.models.database import _load_postgres_schema, db


class TestDatabaseManager:
    """Tests for the DatabaseManager utility class."""

    def test_generate_uuid_returns_valid_string(self) -> None:
        uuid_val = db.generate_uuid()
        assert isinstance(uuid_val, str)
        uuid_length = 36  # UUID format: 8-4-4-4-12
        assert len(uuid_val) == uuid_length

    def test_now_iso_returns_iso_format(self) -> None:
        iso_val = db.now_iso()
        assert isinstance(iso_val, str)
        assert "T" in iso_val

    def test_encode_json(self) -> None:
        data = {"key": "value", "num": 42}
        encoded = db.encode_json(data)
        assert json.loads(encoded) == data

    def test_decode_json(self) -> None:
        raw = '{"key": "value", "num": 42}'
        decoded = db.decode_json(raw)
        assert decoded == {"key": "value", "num": 42}

    def test_roundtrip_json(self) -> None:
        original = [1, 2, {"nested": True}]
        encoded = db.encode_json(original)
        decoded = db.decode_json(encoded)
        assert decoded == original


class TestLoadPostgresSchema:
    """Tests for the _load_postgres_schema function."""

    def test_loads_schema_file(self) -> None:
        """The function should load a SQL string from the bundled schema file."""
        mock_path = MagicMock()
        mock_path.read_text.return_value = "CREATE TABLE test (id SERIAL PRIMARY KEY);"

        with patch("atlas.models.database.importlib.resources.files") as mock_files:
            mock_files.return_value.__truediv__ = MagicMock(return_value=mock_path)
            result = _load_postgres_schema()
            assert "CREATE TABLE" in result
