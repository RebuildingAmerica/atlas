-- ATProto identities linked through profile verification.
CREATE TABLE IF NOT EXISTS atproto_identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    did TEXT NOT NULL,
    current_handle TEXT NOT NULL,
    pds_url TEXT,
    did_resolved_at TEXT NOT NULL,
    handle_verified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, did)
);
CREATE INDEX IF NOT EXISTS idx_atproto_identities_user ON atproto_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_atproto_identities_did ON atproto_identities(did);
