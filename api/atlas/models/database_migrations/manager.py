"""Small conveniences every CRUD module needs from the database."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime


class DatabaseManager:
    """Helper class for database operations."""

    @staticmethod
    def generate_uuid() -> str:
        return str(uuid.uuid4())

    @staticmethod
    def now_iso() -> str:
        return datetime.now(UTC).isoformat()

    @staticmethod
    def encode_json(data: object) -> str:
        return json.dumps(data)

    @staticmethod
    def decode_json(data: str) -> object:
        return json.loads(data)


db = DatabaseManager()
