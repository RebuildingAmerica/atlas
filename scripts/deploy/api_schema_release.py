#!/usr/bin/env python3
"""Apply Atlas PostgreSQL schema once per exact release, outside HTTP requests.

A transaction-scoped advisory lock serializes cooperating release jobs. Schema,
existing migrations and the immutable receipt commit together so directory data
and its provenance stay inspectable across a runtime cutover. Without --apply,
the command opens a read-only transaction and never initializes the database.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import re
import stat
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
LOCK_KEY = 0x41544C415352454C
RECEIPT_TABLE = "atlas_schema_releases"


def canonical_digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def receipt_digest(receipt):
    return canonical_digest(receipt)


def schema_sources_digest(root=ROOT):
    directory = root / "api/atlas/models"
    paths = [
        *directory.joinpath("schema_parts").glob("*.sql"),
        *directory.joinpath("database_migrations").glob("*.py"),
    ]
    if not paths:
        raise ValueError("Repository schema sources are required.")
    return canonical_digest(
        {
            str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(paths)
        }
    )


async def catalog_digest(conn):
    rows = []
    for statement in (
        "SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default "
        "FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position",
        "SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname",
        "SELECT c.relname, k.conname, pg_get_constraintdef(k.oid) FROM pg_constraint k "
        "JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname='public' ORDER BY c.relname,k.conname",
    ):
        rows.append(await (await conn.execute(statement)).fetchall())
    return canonical_digest(rows)


async def schema_release(
    database_url,
    *,
    release_sha,
    apply=False,
    schema_sql=None,
    migration_digest=None,
    migrate=None,
    connect=None,
):
    """Return a credential-free receipt or read-only doctor result.

    Parameters
    ----------
    database_url
        Explicit private PostgreSQL connection string, never included in output.
    release_sha
        Exact committed source identity supplied by the publisher.
    apply
        Explicit permission to initialize/migrate schema. False is read-only.
    """
    import psycopg
    from atlas.models.database import PostgresConnection, _load_postgres_schema
    from atlas.models.database_migrations import migrate_atproto_identity_graph

    if not re.fullmatch(r"[a-f0-9]{40}", release_sha or ""):
        raise ValueError("An exact release commit is required.")
    # libpq connection strings are accepted by the callable API for test/release
    # orchestrators; the CLI additionally requires an explicit PostgreSQL URL.
    identity = psycopg.conninfo.conninfo_to_dict(database_url)
    if not identity.get("dbname") or not identity.get("host"):
        raise ValueError("An explicit PostgreSQL database and host are required.")
    database_identity = canonical_digest(
        {key: identity.get(key, "") for key in ("host", "port", "dbname")}
    )
    schema_sql = _load_postgres_schema() if schema_sql is None else schema_sql
    migration_digest = (
        schema_sources_digest() if migration_digest is None else migration_digest
    )
    if not re.fullmatch(r"[a-f0-9]{64}", migration_digest):
        raise ValueError("An exact migration source digest is required.")
    schema_digest = canonical_digest(
        {"sql": schema_sql, "migrationSourcesDigest": migration_digest}
    )
    connector = connect or psycopg.AsyncConnection.connect
    conn = await connector(database_url, autocommit=False)
    try:
        await conn.execute(
            "SET TRANSACTION READ WRITE" if apply else "SET TRANSACTION READ ONLY"
        )
        await conn.execute("SET LOCAL search_path TO public, pg_catalog")
        await conn.execute("SET LOCAL statement_timeout = '300s'")
        if apply:
            locked = await (
                await conn.execute("SELECT pg_try_advisory_xact_lock(%s)", (LOCK_KEY,))
            ).fetchone()
            if not locked[0]:
                raise ValueError("Another Atlas schema release is already running.")
        exists = (
            await (
                await conn.execute("SELECT to_regclass('public.atlas_schema_releases')")
            ).fetchone()
        )[0]
        if apply and not exists:
            await conn.execute(
                "CREATE TABLE public.atlas_schema_releases (release_sha TEXT PRIMARY KEY, schema_digest TEXT NOT NULL, receipt JSONB NOT NULL)"
            )
            exists = RECEIPT_TABLE
        previous = None
        if exists:
            previous = await (
                await conn.execute(
                    "SELECT schema_digest,receipt FROM public.atlas_schema_releases WHERE release_sha=%s",
                    (release_sha,),
                )
            ).fetchone()
        if previous:
            if previous[0] != schema_digest:
                raise ValueError("This release already names a different schema.")
            receipt = previous[1]
            if receipt["databaseIdentityDigest"] != database_identity or receipt[
                "catalogDigest"
            ] != await catalog_digest(conn):
                raise ValueError(
                    "The database catalog differs from its release receipt."
                )
            await conn.rollback()
            return {
                "status": "already-applied" if apply else "ready",
                "receipt": receipt,
                "receiptDigest": receipt_digest(receipt),
            }
        if not apply:
            await conn.rollback()
            return {
                "status": "missing",
                "releaseSha": release_sha,
                "schemaDigest": schema_digest,
                "databaseIdentityDigest": database_identity,
            }
        await (migrate or migrate_atproto_identity_graph)(
            PostgresConnection(conn), backend="postgres"
        )
        await conn.execute(schema_sql)
        receipt = {
            "schemaVersion": 1,
            "kind": "atlas-postgres-schema-release",
            "releaseSha": release_sha,
            "schemaDigest": schema_digest,
            "migrationSourcesDigest": migration_digest,
            "databaseIdentityDigest": database_identity,
            "catalogDigest": await catalog_digest(conn),
            "completedAt": datetime.now(timezone.utc).isoformat(),
        }
        await conn.execute(
            "INSERT INTO public.atlas_schema_releases (release_sha,schema_digest,receipt) VALUES (%s,%s,%s::jsonb)",
            (release_sha, schema_digest, json.dumps(receipt)),
        )
        await conn.commit()
        return {
            "status": "applied",
            "receipt": receipt,
            "receiptDigest": receipt_digest(receipt),
        }
    except BaseException:
        await conn.rollback()
        raise
    finally:
        await conn.close()


def private_config(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) & 0o077:
        raise ValueError("The supplied private runtime/config file must be owner-only.")
    config = json.loads(path.read_text())
    url = config.get("DATABASE_URL")
    if not isinstance(url, str) or not url.startswith(("postgresql://", "postgres://")):
        raise ValueError(
            "The private runtime/config must supply DATABASE_URL for PostgreSQL."
        )
    return url


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-file", type=Path, required=True)
    parser.add_argument("--release-sha", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    try:
        committed = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip()
        dirty = subprocess.check_output(
            ["git", "status", "--porcelain"], cwd=ROOT, text=True
        ).strip()
        if args.release_sha != committed or dirty:
            raise ValueError("An exact clean committed release is required.")
        result = asyncio.run(
            schema_release(
                private_config(args.config_file),
                release_sha=committed,
                apply=args.apply,
            )
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        # No DSN, settings, credentials or provider diagnostics enter this receipt.
        args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
        print(
            json.dumps(
                {
                    "status": result["status"],
                    "receiptDigest": result.get("receiptDigest"),
                }
            )
        )
        return 0
    except Exception:
        print(
            "Schema release failed; private database/configuration diagnostics were suppressed.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
