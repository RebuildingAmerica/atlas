"""DDL for the ATProto identity graph, per backend."""

from __future__ import annotations

_ATPROTO_GRAPH_SQLITE_DDL = (
    """
    CREATE TABLE IF NOT EXISTS atproto_identities (
        id TEXT PRIMARY KEY,
        did TEXT NOT NULL,
        current_handle TEXT NOT NULL,
        pds_url TEXT,
        resolution_status TEXT NOT NULL DEFAULT 'verified'
            CHECK(resolution_status IN ('verified', 'needs_attention')),
        did_resolved_at TEXT,
        handle_verified_at TEXT,
        last_resolution_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(did)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_atproto_controls (
        id TEXT PRIMARY KEY,
        identity_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'disconnected', 'conflict')),
        verified_at TEXT,
        disconnected_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, identity_id),
        FOREIGN KEY (identity_id) REFERENCES atproto_identities(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS profile_atproto_links (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        identity_id TEXT NOT NULL,
        claim_id TEXT,
        proof_id TEXT,
        status TEXT NOT NULL
            CHECK(status IN ('verified', 'reverification_required', 'removed')),
        verified_at TEXT,
        last_checked_at TEXT,
        removed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
        FOREIGN KEY (identity_id) REFERENCES atproto_identities(id) ON DELETE CASCADE,
        FOREIGN KEY (claim_id) REFERENCES profile_claims(id) ON DELETE SET NULL,
        FOREIGN KEY (proof_id) REFERENCES profile_claim_proofs(id) ON DELETE SET NULL
    )
    """,
)

_ATPROTO_GRAPH_POSTGRES_DDL = (
    """
    CREATE TABLE IF NOT EXISTS atproto_identities (
        id TEXT PRIMARY KEY,
        did TEXT NOT NULL,
        current_handle TEXT NOT NULL,
        pds_url TEXT,
        resolution_status TEXT NOT NULL DEFAULT 'verified'
            CHECK(resolution_status IN ('verified', 'needs_attention')),
        did_resolved_at TIMESTAMPTZ,
        handle_verified_at TIMESTAMPTZ,
        last_resolution_error TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(did)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_atproto_controls (
        id TEXT PRIMARY KEY,
        identity_id TEXT NOT NULL REFERENCES atproto_identities(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'disconnected', 'conflict')),
        verified_at TIMESTAMPTZ,
        disconnected_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(user_id, identity_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS profile_atproto_links (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        identity_id TEXT NOT NULL REFERENCES atproto_identities(id) ON DELETE CASCADE,
        claim_id TEXT REFERENCES profile_claims(id) ON DELETE SET NULL,
        proof_id TEXT REFERENCES profile_claim_proofs(id) ON DELETE SET NULL,
        status TEXT NOT NULL
            CHECK(status IN ('verified', 'reverification_required', 'removed')),
        verified_at TIMESTAMPTZ,
        last_checked_at TIMESTAMPTZ,
        removed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
    )
    """,
)

_ATPROTO_GRAPH_INDEX_DDL = (
    "CREATE INDEX IF NOT EXISTS idx_user_atproto_controls_user ON user_atproto_controls(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_user_atproto_controls_identity "
    "ON user_atproto_controls(identity_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_user_atproto_controls_active_identity "
    "ON user_atproto_controls(identity_id) WHERE status = 'active'",
    "CREATE INDEX IF NOT EXISTS idx_profile_atproto_links_identity "
    "ON profile_atproto_links(identity_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_atproto_links_non_removed_entry "
    "ON profile_atproto_links(entry_id) WHERE status <> 'removed'",
)

_ATPROTO_CONTROL_COLUMNS = (
    "id",
    "identity_id",
    "user_id",
    "status",
    "verified_at",
    "disconnected_at",
    "created_at",
    "updated_at",
)

_ATPROTO_PROFILE_LINK_COLUMNS = (
    "id",
    "entry_id",
    "identity_id",
    "claim_id",
    "proof_id",
    "status",
    "verified_at",
    "last_checked_at",
    "removed_at",
    "created_at",
    "updated_at",
)
