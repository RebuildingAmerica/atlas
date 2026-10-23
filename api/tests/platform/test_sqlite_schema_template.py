"""The schema template every SQLite test copies must equal a database ``init_db`` builds."""

import sqlite3
from contextlib import closing
from pathlib import Path

from atlas.models import init_db


def _schema(database: Path) -> list[tuple[str, str, str | None]]:
    """Return every object the database defines: its type, name, and SQL."""
    with closing(sqlite3.connect(database)) as connection:
        rows = connection.execute("SELECT type, name, sql FROM sqlite_master ORDER BY 1, 2")
        return [(str(kind), str(name), sql) for kind, name, sql in rows]


def _row_counts(database: Path) -> dict[str, int]:
    """Return how many rows ``init_db`` seeded into each table.

    Compared by count rather than content because seeded rows carry the moment
    they were written, which differs between any two builds.
    """
    with closing(sqlite3.connect(database)) as connection:
        tables = [
            str(name)
            for (name,) in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        ]
        return {
            table: connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]  # noqa: S608
            for table in tables
        }


def _journal_mode(database: Path) -> str:
    with closing(sqlite3.connect(database)) as connection:
        return str(connection.execute("PRAGMA journal_mode").fetchone()[0])


async def test_template_matches_a_database_built_by_init_db(
    sqlite_schema_template: Path, tmp_path: Path
) -> None:
    """A copy of the template must be the database ``init_db`` would have built."""
    fresh = tmp_path / "fresh.db"
    await init_db(f"sqlite:///{fresh}", backend="sqlite")

    assert _schema(sqlite_schema_template) == _schema(fresh)
    assert _row_counts(sqlite_schema_template) == _row_counts(fresh)
    assert _journal_mode(sqlite_schema_template) == _journal_mode(fresh) == "wal"


def test_template_has_no_write_ahead_log_waiting_to_be_copied(
    sqlite_schema_template: Path,
) -> None:
    """Copying the main file alone loses anything still in the log, so none may remain."""
    log = Path(f"{sqlite_schema_template}-wal")

    assert not log.exists() or log.stat().st_size == 0
