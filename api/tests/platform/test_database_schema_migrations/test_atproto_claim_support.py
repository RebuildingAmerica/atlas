"""ATProto identity graph migration: claim support cases."""

from __future__ import annotations

from typing import TYPE_CHECKING

import aiosqlite
import pytest

from atlas.models.database import (
    init_db,
)

if TYPE_CHECKING:
    from pathlib import Path

from tests.platform.test_database_schema_migrations.support import (
    LEGACY_ATPROTO_COLUMNS,
    TIMESTAMP,
    _insert_atproto_claim_proof,
    _insert_legacy_entry,
    _insert_legacy_identity_link,
    _legacy_database,
)


class TestMigrateAtprotoIdentityGraph:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("claim_status", "proof_status"),
        [
            ("pending", "verified"),
            ("rejected", "verified"),
            ("revoked", "verified"),
            ("verified", "pending"),
            ("verified", "rejected"),
            ("verified", "revoked"),
        ],
    )
    async def test_unverified_claim_or_proof_is_not_profile_link_support(
        self,
        tmp_path: Path,
        claim_status: str,
        proof_status: str,
    ) -> None:
        """Unverified evidence should never support a migrated verified profile link."""
        database_path = tmp_path / "unverified-proof.db"
        conn = await _legacy_database(database_path)
        try:
            await _insert_legacy_identity_link(
                conn,
                key="proof",
                did="did:plc:proof",
                handle="proof.example",
            )
            await _insert_atproto_claim_proof(
                conn,
                suffix="unverified",
                entry_id="entry-proof",
                statuses=(claim_status, proof_status),
                reviewed_at=TIMESTAMP,
            )
            await conn.commit()
        finally:
            await conn.close()

        await init_db(f"sqlite:///{database_path}")

        conn = await aiosqlite.connect(database_path)
        try:
            link_cursor = await conn.execute(
                "SELECT status, claim_id, proof_id FROM profile_atproto_links"
            )
            assert await link_cursor.fetchone() == ("verified", None, None)
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_newest_verified_claim_and_proof_support_profile_link(
        self,
        tmp_path: Path,
    ) -> None:
        """Mixed evidence should select the newest verified claim and verified proof."""
        database_path = tmp_path / "mixed-proofs.db"
        conn = await _legacy_database(database_path)
        try:
            await _insert_legacy_identity_link(
                conn,
                key="proof",
                did="did:plc:proof",
                handle="proof.example",
            )
            await _insert_atproto_claim_proof(
                conn,
                suffix="verified-old",
                entry_id="entry-proof",
                statuses=("verified", "verified"),
                reviewed_at="2026-07-09T12:00:00+00:00",
            )
            expected = await _insert_atproto_claim_proof(
                conn,
                suffix="verified-new",
                entry_id="entry-proof",
                statuses=("verified", "verified"),
                reviewed_at="2026-07-10T12:00:00+00:00",
            )
            await _insert_atproto_claim_proof(
                conn,
                suffix="rejected-newest",
                entry_id="entry-proof",
                statuses=("rejected", "verified"),
                reviewed_at="2026-07-12T12:00:00+00:00",
            )
            await _insert_atproto_claim_proof(
                conn,
                suffix="pending-newest",
                entry_id="entry-proof",
                statuses=("verified", "pending"),
                reviewed_at="2026-07-13T12:00:00+00:00",
            )
            await conn.commit()
        finally:
            await conn.close()

        await init_db(f"sqlite:///{database_path}")

        conn = await aiosqlite.connect(database_path)
        try:
            link_cursor = await conn.execute(
                "SELECT status, claim_id, proof_id FROM profile_atproto_links"
            )
            assert await link_cursor.fetchone() == ("verified", *expected)
        finally:
            await conn.close()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("did", "handle", "verified_at"),
        [
            ("did:plc:partial", None, None),
            (None, "partial.example", None),
            (None, None, "2026-07-08T12:00:00+00:00"),
        ],
    )
    async def test_corrupt_partial_profile_identity_rolls_back(
        self,
        tmp_path: Path,
        did: str | None,
        handle: str | None,
        verified_at: str | None,
    ) -> None:
        """Partial legacy identity data should fail instead of inventing trusted provenance."""
        database_path = tmp_path / "partial.db"
        conn = await _legacy_database(database_path)
        try:
            await conn.execute(
                """
                INSERT INTO atproto_identities (
                    id, user_id, did, current_handle, pds_url, did_resolved_at,
                    handle_verified_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)
                """,
                (
                    "identity-still-legacy",
                    "user-one",
                    "did:plc:one",
                    "one.example",
                    TIMESTAMP,
                    TIMESTAMP,
                    TIMESTAMP,
                    TIMESTAMP,
                ),
            )
            await _insert_legacy_entry(
                conn,
                "entry-partial",
                did=did,
                handle=handle,
                verified_at=verified_at,
            )
            await conn.commit()
        finally:
            await conn.close()

        with pytest.raises(
            RuntimeError,
            match="Corrupt legacy ATProto link for entry entry-partial",
        ):
            await init_db(f"sqlite:///{database_path}")

        conn = await aiosqlite.connect(database_path)
        try:
            identity_columns_cursor = await conn.execute("PRAGMA table_info(atproto_identities)")
            identity_columns = {str(row[1]) for row in await identity_columns_cursor.fetchall()}
            assert "user_id" in identity_columns
            legacy_identity_cursor = await conn.execute(
                "SELECT id FROM atproto_identities WHERE id = 'identity-still-legacy'"
            )
            assert await legacy_identity_cursor.fetchone() == ("identity-still-legacy",)

            entry_columns_cursor = await conn.execute("PRAGMA table_info(entries)")
            entry_columns = {str(row[1]) for row in await entry_columns_cursor.fetchall()}
            assert entry_columns >= LEGACY_ATPROTO_COLUMNS

            table_cursor = await conn.execute(
                """
                SELECT name FROM sqlite_master
                WHERE type = 'table'
                  AND name IN ('user_atproto_controls', 'profile_atproto_links')
                """
            )
            assert await table_cursor.fetchall() == []
        finally:
            await conn.close()
