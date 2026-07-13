-- Stable ATProto identities and their verified Atlas relationships.
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
);

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
);
CREATE INDEX IF NOT EXISTS idx_user_atproto_controls_user
    ON user_atproto_controls(user_id);
CREATE INDEX IF NOT EXISTS idx_user_atproto_controls_identity
    ON user_atproto_controls(identity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_atproto_controls_active_identity
    ON user_atproto_controls(identity_id) WHERE status = 'active';

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
);
CREATE INDEX IF NOT EXISTS idx_profile_atproto_links_identity
    ON profile_atproto_links(identity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_atproto_links_non_removed_entry
    ON profile_atproto_links(entry_id) WHERE status <> 'removed';

CREATE TABLE IF NOT EXISTS organization_atproto_identities (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    identity_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'removed')),
    attached_by TEXT NOT NULL,
    attached_at TEXT NOT NULL,
    detached_by TEXT,
    detached_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(organization_id, identity_id),
    FOREIGN KEY (identity_id) REFERENCES atproto_identities(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_atproto_active_identity
    ON organization_atproto_identities(organization_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS atproto_identity_delegations (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    identity_id TEXT NOT NULL,
    controller_user_id TEXT NOT NULL,
    delegate_user_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'revoked')),
    granted_by TEXT NOT NULL,
    granted_at TEXT NOT NULL,
    revoked_by TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(organization_id, identity_id, delegate_user_id),
    FOREIGN KEY (identity_id) REFERENCES atproto_identities(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_atproto_delegations_delegate
    ON atproto_identity_delegations(delegate_user_id, status);

-- Discount verification records awaiting billing review.
CREATE TABLE IF NOT EXISTS discount_verifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    segment TEXT NOT NULL CHECK (
        segment IN (
            'student',
            'independent_journalist',
            'grassroots_nonprofit',
            'civic_tech_worker'
        )
    ),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'verified', 'rejected', 'expired')
    ),
    method TEXT NOT NULL CHECK (
        method IN ('portfolio', 'school_email', 'ein_submission', 'mission_statement')
    ),
    submitted_at TEXT NOT NULL,
    verified_at TEXT,
    verification_data_json TEXT NOT NULL DEFAULT '{}',
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_discount_verifications_status_segment
    ON discount_verifications(status, segment);
CREATE INDEX IF NOT EXISTS idx_discount_verifications_organization
    ON discount_verifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_discount_verifications_user
    ON discount_verifications(user_id);
