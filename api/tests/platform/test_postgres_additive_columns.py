"""Guards that a column added to a Postgres table reaches existing databases.

``CREATE TABLE IF NOT EXISTS`` does nothing to a table that already exists, so a
column appended to a definition in ``schema_parts`` lands only on databases
created afterwards. Production is never one of those. The schema files carry an
``ALTER TABLE ... ADD COLUMN IF NOT EXISTS`` line per late-added column to close
that gap, and these tests fail when one is missing.

The gap is silent until something writes the column: discovery ran for two
months enqueuing nothing because ``discovery_jobs`` in production lacked
``execution_mode`` and ``input_payload``.
"""

from __future__ import annotations

import re
from pathlib import Path

SCHEMA_PARTS = Path(__file__).resolve().parents[2] / "atlas" / "models" / "schema_parts"

# Columns each table gained after its first deploy. SQLite applies these through
# the additive lists in atlas.models.database_migrations; Postgres needs a
# matching ALTER because its schema is declarative.
LATE_ADDED_COLUMNS: dict[str, set[str]] = {
    "discovery_jobs": {
        "idempotency_key",
        "next_attempt_at",
        "execution_mode",
        "input_payload",
    },
}


def _schema_sql() -> str:
    """Concatenate the Postgres schema fragments the way init_db does."""
    return "\n".join(part.read_text() for part in sorted(SCHEMA_PARTS.glob("*.sql")))


def _altered_columns(sql: str, table: str) -> set[str]:
    """Return the columns `table` gains through ADD COLUMN IF NOT EXISTS."""
    pattern = re.compile(
        rf"ALTER\s+TABLE\s+{table}\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)",
        re.IGNORECASE,
    )
    return set(pattern.findall(sql))


def _created_columns(sql: str, table: str) -> set[str]:
    """Return the columns `table` declares in its CREATE TABLE body."""
    match = re.search(
        rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{table}\s*\((.*?)\n\);",
        sql,
        re.IGNORECASE | re.DOTALL,
    )
    assert match is not None, f"No CREATE TABLE found for {table}"
    columns: set[str] = set()
    for line in match.group(1).splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(("--", "CHECK", "UNIQUE", "PRIMARY", "FOREIGN")):
            continue
        columns.add(stripped.split()[0])
    return columns


class TestPostgresAdditiveColumns:
    """Every late-added column needs an ALTER, not just a CREATE TABLE entry."""

    def test_late_added_columns_have_an_alter(self) -> None:
        sql = _schema_sql()
        for table, expected in LATE_ADDED_COLUMNS.items():
            missing = expected - _altered_columns(sql, table)
            assert not missing, (
                f"{table} gained {sorted(missing)} in CREATE TABLE with no matching "
                f"ALTER TABLE ... ADD COLUMN IF NOT EXISTS, so a database created "
                f"before those columns never gets them."
            )

    def test_altered_columns_are_declared_in_create_table(self) -> None:
        sql = _schema_sql()
        for table in LATE_ADDED_COLUMNS:
            orphaned = _altered_columns(sql, table) - _created_columns(sql, table)
            assert not orphaned, (
                f"{table} is altered to add {sorted(orphaned)}, which its CREATE TABLE "
                f"does not declare, so a fresh database and an existing one disagree."
            )
