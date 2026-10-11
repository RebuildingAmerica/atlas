"""Preserve Atlas's PostgreSQL transactions and row shapes through Hyperdrive."""

import json
import re
from collections.abc import Sequence
from datetime import date, datetime
from typing import Any

_SQL_TOKEN = re.compile(
    r"E'(?:\\.|''|[^'])*'|'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\""
    r"|--[^\n]*|/\*.*?\*/|\$(?P<tag>[a-zA-Z_][a-zA-Z_0-9]*|)\$.*?\$(?P=tag)\$|\?",
    re.DOTALL | re.IGNORECASE,
)


def translate_parameters(sql: str) -> str:
    """Number Atlas's qmark parameters without changing quoted source text."""
    count = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal count
        if match.group() != "?":
            return match.group()
        count += 1
        return f"${count}"

    return _SQL_TOKEN.sub(replace, sql)


def _encode_date(value: str | date) -> str:
    return value.isoformat() if isinstance(value, date) else value


def _decode_timestamp(value: str) -> str:
    return datetime.fromisoformat(value).isoformat()


class Cursor:
    """Materialized result with the cursor contract used by Atlas's models."""

    def __init__(self, rows: list[tuple[Any, ...]], description: Any, rowcount: int):
        self._rows = rows
        self._offset = 0
        self.description = description
        self.rowcount = rowcount

    async def fetchone(self) -> tuple[Any, ...] | None:
        if self._offset == len(self._rows):
            return None
        row = self._rows[self._offset]
        self._offset += 1
        return row

    async def fetchall(self) -> list[tuple[Any, ...]]:
        rows = self._rows[self._offset :]
        self._offset = len(self._rows)
        return rows


class Connection:
    """A request owns one connection; uncommitted work rolls back on close."""

    backend = "postgres"

    def __init__(self, connection: Any):
        self._connection = connection
        self._transaction = None

    async def _begin(self) -> None:
        if self._transaction is None:
            transaction = self._connection.transaction()
            await transaction.start()
            self._transaction = transaction
            # Hyperdrive pools by transaction, so startup settings alone cannot
            # guarantee consistent dates on profiles and workspace records.
            await self._connection.execute("SET LOCAL TIME ZONE 'UTC'")

    async def execute(self, sql: str, parameters: Sequence[Any] = ()) -> Cursor:
        command = sql.strip().rstrip(";").upper()
        if command in {"COMMIT", "ROLLBACK"}:
            await (self.commit() if command == "COMMIT" else self.rollback())
            return Cursor([], None, -1)
        await self._begin()
        statement = await self._connection.prepare(translate_parameters(sql))
        records = await statement.fetch(*parameters)
        attributes = statement.get_attributes()
        description = [(item.name,) for item in attributes] if attributes else None
        status = statement.get_statusmsg() or ""
        last = status.rsplit(" ", 1)[-1]
        rowcount = int(last) if last.isdecimal() else -1
        return Cursor([tuple(row) for row in records], description, rowcount)

    async def executemany(
        self, sql: str, parameters: Sequence[Sequence[Any]]
    ) -> Cursor:
        rowcount = 0
        for values in parameters:
            cursor = await self.execute(sql, values)
            rowcount += cursor.rowcount
        return Cursor([], None, rowcount)

    async def commit(self) -> None:
        if self._transaction is not None:
            await self._transaction.commit()
            self._transaction = None

    async def rollback(self) -> None:
        if self._transaction is not None:
            await self._transaction.rollback()
            self._transaction = None

    async def close(self) -> None:
        if self.is_closed():
            return
        try:
            await self.rollback()
        finally:
            await self._connection.close()

    def is_closed(self) -> bool:
        return self._connection.is_closed()


async def connect_database(
    *, host: str, port: int, user: str, password: str, database: str
) -> Connection:
    """Connect only through the supplied trusted Hyperdrive binding endpoint."""
    import asyncpg

    connection = await asyncpg.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
        ssl=False,
        # Cloudflare advances its frozen clock at I/O boundaries; cold Python
        # initialization can become visible during the handshake. Preserve the
        # bounded 30-second connection budget so search can reach the
        # database. Separate hosted latency gates still reject slow releases.
        timeout=30,
        command_timeout=30,
    )
    try:
        for name in ("timestamp", "timestamptz"):
            await connection.set_type_codec(
                name,
                schema="pg_catalog",
                encoder=_encode_date,
                decoder=_decode_timestamp,
                format="text",
            )
        await connection.set_type_codec(
            "date",
            schema="pg_catalog",
            encoder=_encode_date,
            decoder=lambda value: date.fromisoformat(value).isoformat(),
            format="text",
        )
        for name in ("json", "jsonb"):
            await connection.set_type_codec(
                name,
                schema="pg_catalog",
                encoder=lambda value: (
                    value if isinstance(value, str) else json.dumps(value)
                ),
                decoder=json.loads,
                format="text",
            )
        return Connection(connection)
    except BaseException:
        await connection.close()
        raise
