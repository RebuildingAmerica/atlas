-- ATProto identities linked through profile verification.
CREATE TABLE IF NOT EXISTS atproto_identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    did TEXT NOT NULL,
    current_handle TEXT NOT NULL,
    pds_url TEXT,
    did_resolved_at TIMESTAMPTZ NOT NULL,
    handle_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE(user_id, did)
);
CREATE INDEX IF NOT EXISTS idx_atproto_identities_user ON atproto_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_atproto_identities_did ON atproto_identities(did);

ALTER TABLE entries ADD COLUMN IF NOT EXISTS linked_atproto_did TEXT;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS linked_atproto_handle TEXT;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS linked_atproto_verified_at TIMESTAMPTZ;

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
    submitted_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    verification_data_json TEXT NOT NULL DEFAULT '{}',
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_discount_verifications_status_segment
    ON discount_verifications(status, segment);
CREATE INDEX IF NOT EXISTS idx_discount_verifications_organization
    ON discount_verifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_discount_verifications_user
    ON discount_verifications(user_id);
