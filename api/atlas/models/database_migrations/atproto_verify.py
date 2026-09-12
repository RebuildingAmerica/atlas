"""Post-migration assertions, so a half-applied migration cannot commit."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .atproto_queries import _table_count

if TYPE_CHECKING:
    from .atproto_records import _AtprotoMigrationExpectations


async def _assert_atproto_migration(
    conn: Any,
    expected: _AtprotoMigrationExpectations,
) -> None:
    actual_counts = (
        await _table_count(conn, "atproto_identities"),
        await _table_count(conn, "user_atproto_controls"),
        await _table_count(conn, "profile_atproto_links"),
    )
    expected_counts = (expected.identity_count, expected.control_count, expected.link_count)
    if actual_counts != expected_counts:
        msg = (
            "ATProto identity migration row-count mismatch: "
            f"expected {expected_counts}, found {actual_counts}"
        )
        raise RuntimeError(msg)

    for did, identity in expected.identities.items():
        cursor = await conn.execute(
            """
            SELECT id, did, current_handle, pds_url, resolution_status,
                   did_resolved_at, handle_verified_at, last_resolution_error,
                   created_at, updated_at
            FROM atproto_identities
            WHERE did = ?
            """,
            (did,),
        )
        row = await cursor.fetchone()
        expected_identity = (
            identity.id,
            identity.did,
            identity.current_handle,
            identity.pds_url,
            identity.resolution_status,
            identity.did_resolved_at,
            identity.handle_verified_at,
            identity.last_resolution_error,
            identity.created_at,
            identity.updated_at,
        )
        if row != expected_identity:
            msg = f"ATProto identity migration data mismatch for DID {did}"
            raise RuntimeError(msg)

    for control in expected.controls:
        cursor = await conn.execute(
            """
            SELECT id, identity_id, user_id, status, verified_at,
                   disconnected_at, created_at, updated_at
            FROM user_atproto_controls
            WHERE id = ?
            """,
            (control[0],),
        )
        if await cursor.fetchone() != control:
            msg = f"ATProto control migration data mismatch for user {control[2]}"
            raise RuntimeError(msg)

    for link in expected.links:
        cursor = await conn.execute(
            """
            SELECT id, entry_id, identity_id, claim_id, proof_id, status,
                   verified_at, last_checked_at, removed_at, created_at, updated_at
            FROM profile_atproto_links
            WHERE id = ?
            """,
            (link[0],),
        )
        if await cursor.fetchone() != link:
            msg = f"ATProto profile-link migration data mismatch for entry {link[1]}"
            raise RuntimeError(msg)
