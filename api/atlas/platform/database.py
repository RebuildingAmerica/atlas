"""Platform database utilities and re-exports."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

__all__ = ["DatabaseManager", "db", "get_db_connection", "init_db"]


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


async def get_db_connection(database_url: str, *, backend: str | None = None) -> Any:
    """Get an async database connection (delegates to atlas.models.database)."""
    from atlas.models.database import get_db_connection as _get_db_connection

    return await _get_db_connection(database_url, backend=backend)


async def init_db(database_url: str, *, backend: str | None = None) -> None:
    """Initialize database schema (delegates to atlas.models.database)."""
    from atlas.models.database import init_db as _init_db

    await _init_db(database_url, backend=backend)
