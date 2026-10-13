"""Exercise schema releases against a dedicated disposable PostgreSQL database."""

import asyncio
import importlib.util
import json
import os
from pathlib import Path
import unittest
import uuid

import psycopg
from psycopg import sql

SPEC = importlib.util.spec_from_file_location(
    "schema_release", Path(__file__).with_name("api_schema_release.py")
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SchemaReleaseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # This explicit opt-in never touches an application database.
        self.admin = os.environ["ATLAS_SCHEMA_TEST_ADMIN_URL"]
        self.name = "atlas_schema_release_test_" + uuid.uuid4().hex
        async with await psycopg.AsyncConnection.connect(
            self.admin, autocommit=True
        ) as conn:
            await conn.execute(
                sql.SQL("CREATE DATABASE {}").format(sql.Identifier(self.name))
            )
        self.url = psycopg.conninfo.make_conninfo(self.admin, dbname=self.name)

    async def asyncTearDown(self):
        async with await psycopg.AsyncConnection.connect(
            self.admin, autocommit=True
        ) as conn:
            await conn.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(
                    sql.Identifier(self.name)
                )
            )

    async def run_release(
        self,
        *,
        apply=False,
        sha="a" * 40,
        schema="CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY);",
        migrate=None,
    ):
        return await MODULE.schema_release(
            self.url,
            release_sha=sha,
            apply=apply,
            schema_sql=schema,
            migration_digest="b" * 64,
            migrate=migrate or noop,
        )

    async def test_doctor_is_read_only_before_and_after_idempotent_release(self):
        before = await self.run_release()
        self.assertEqual(before["status"], "missing")
        async with await psycopg.AsyncConnection.connect(self.url) as conn:
            self.assertIsNone(
                (
                    await (
                        await conn.execute(
                            "SELECT to_regclass('atlas_schema_releases')"
                        )
                    ).fetchone()
                )[0]
            )
        receipt = await self.run_release(apply=True)
        self.assertEqual(receipt["status"], "applied")
        repeated = await self.run_release(apply=True)
        self.assertEqual(repeated["receipt"], receipt["receipt"])
        self.assertEqual(repeated["status"], "already-applied")
        self.assertEqual((await self.run_release())["status"], "ready")
        self.assertNotIn(self.url, json.dumps(receipt))
        self.assertEqual(
            MODULE.receipt_digest(receipt["receipt"]), receipt["receiptDigest"]
        )

    async def test_failure_rolls_back_schema_and_receipt_together(self):
        async def fail(adapter, *, backend):
            await adapter.execute("CREATE TABLE partial_work (id TEXT)")
            raise RuntimeError("private database detail")

        with self.assertRaisesRegex(RuntimeError, "private database detail"):
            await self.run_release(apply=True, migrate=fail)
        async with await psycopg.AsyncConnection.connect(self.url) as conn:
            for table in ["partial_work", "atlas_schema_releases", "records"]:
                self.assertIsNone(
                    (
                        await (
                            await conn.execute("SELECT to_regclass(%s)", (table,))
                        ).fetchone()
                    )[0]
                )

    async def test_doctor_reports_idle_transactions_without_connection_details(self):
        async with await psycopg.AsyncConnection.connect(self.url) as conn:
            await conn.execute("SELECT 1")
            result = await self.run_release()
            self.assertEqual(result["databaseActivity"]["idleTransactions"], 1)
            self.assertEqual(result["databaseActivity"]["lockWaiters"], 0)
            self.assertNotIn(self.url, json.dumps(result))
            self.assertNotIn("SELECT", json.dumps(result))

    async def test_advisory_lock_rejects_concurrent_job_without_waiting(self):
        entered, release = asyncio.Event(), asyncio.Event()

        async def hold(adapter, *, backend):
            entered.set()
            await release.wait()

        first = asyncio.create_task(self.run_release(apply=True, migrate=hold))
        await entered.wait()
        try:
            with self.assertRaisesRegex(ValueError, "already running"):
                await self.run_release(apply=True, sha="c" * 40)
        finally:
            release.set()
            await first

    async def test_source_and_catalog_drift_fail_closed(self):
        await self.run_release(apply=True)
        with self.assertRaisesRegex(ValueError, "different schema"):
            await self.run_release(
                apply=True, schema="CREATE TABLE different (id TEXT);"
            )
        async with await psycopg.AsyncConnection.connect(self.url) as conn:
            await conn.execute("ALTER TABLE records ADD COLUMN changed TEXT")
        with self.assertRaisesRegex(ValueError, "catalog differs"):
            await self.run_release(apply=True)
        with self.assertRaisesRegex(ValueError, "catalog differs"):
            await self.run_release()

    async def test_new_release_requires_apply_and_preserves_old_receipt(self):
        old = await self.run_release(apply=True)
        self.assertEqual((await self.run_release(sha="c" * 40))["status"], "missing")
        new = await self.run_release(apply=True, sha="c" * 40)
        self.assertNotEqual(old["receiptDigest"], new["receiptDigest"])
        self.assertEqual((await self.run_release())["receipt"], old["receipt"])

    async def test_real_repository_schema_is_initialized_by_existing_migration(self):
        from atlas.models.database import _load_postgres_schema
        from atlas.models.database_migrations import migrate_atproto_identity_graph

        result = await self.run_release(
            apply=True,
            schema=_load_postgres_schema(),
            migrate=migrate_atproto_identity_graph,
        )
        self.assertEqual(result["status"], "applied")
        async with await psycopg.AsyncConnection.connect(self.url) as conn:
            for table in ["entries", "discovery_jobs", "discovery_web_checkpoints"]:
                self.assertEqual(
                    (
                        await (
                            await conn.execute("SELECT to_regclass(%s)", (table,))
                        ).fetchone()
                    )[0],
                    table,
                )


async def noop(adapter, *, backend):
    pass


if __name__ == "__main__":
    unittest.main()
