INSERT INTO place_related_places (
    id,
    place_key,
    name,
    href,
    kind,
    source_dataset,
    source_identifier,
    source_url,
    latitude,
    longitude,
    summary,
    accent,
    sort_order
)
VALUES
    ('las-vegas-nv-henderson', 'las-vegas-nv', 'Henderson', '/places/cities/henderson-nv', 'city', 'U.S. Census Bureau Places', 'census:place/3231900', 'https://www.census.gov/programs-surveys/geography.html', 36.039525, -114.981721, 'Housing growth, water, parks, transit access, public safety.', 'neutral', 10),
    ('las-vegas-nv-north-las-vegas', 'las-vegas-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', 'city', 'U.S. Census Bureau Places', 'census:place/3251800', 'https://www.census.gov/programs-surveys/geography.html', 36.200000, -115.120000, 'Industrial growth, housing, transit access, parks, and public safety.', 'neutral', 20)
ON CONFLICT (id) DO UPDATE SET
    place_key = EXCLUDED.place_key,
    name = EXCLUDED.name,
    href = EXCLUDED.href,
    kind = EXCLUDED.kind,
    source_dataset = EXCLUDED.source_dataset,
    source_identifier = EXCLUDED.source_identifier,
    source_url = EXCLUDED.source_url,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    summary = EXCLUDED.summary,
    accent = EXCLUDED.accent,
    sort_order = EXCLUDED.sort_order;
-- Additive migration: slug column (safe to re-run on existing databases).
ALTER TABLE entries ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_entries_slug ON entries(slug);
ALTER TABLE org_annotations ALTER COLUMN entry_id DROP NOT NULL;
ALTER TABLE org_annotations ADD COLUMN IF NOT EXISTS source_id TEXT REFERENCES sources(id);
ALTER TABLE org_annotations ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'entry';
ALTER TABLE org_annotations ADD COLUMN IF NOT EXISTS target_id TEXT;
UPDATE org_annotations SET target_id = entry_id WHERE target_id IS NULL AND entry_id IS NOT NULL;

-- Discovery jobs (durable pipeline execution tracking)
CREATE TABLE IF NOT EXISTS discovery_jobs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'claimed', 'running', 'completed', 'failed', 'cancelled')),
    progress TEXT,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 2,
    claimed_by TEXT,
    claimed_until TIMESTAMPTZ,
    idempotency_key TEXT,
    next_attempt_at TIMESTAMPTZ,
    execution_mode TEXT NOT NULL DEFAULT 'search' CHECK(execution_mode IN ('search', 'direct_url')),
    input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);
ALTER TABLE discovery_jobs ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE discovery_jobs ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_status ON discovery_jobs(status);
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_run_id ON discovery_jobs(run_id);
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_claimed_until ON discovery_jobs(claimed_until);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_jobs_idempotency ON discovery_jobs(idempotency_key);

-- Cost ledger (per-call metering for discovery spend ceilings + kill switch)
CREATE TABLE IF NOT EXISTS cost_ledger (
    id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES discovery_runs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    units REAL NOT NULL,
    estimated_cost REAL NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_ledger_run_id ON cost_ledger(run_id);
CREATE INDEX IF NOT EXISTS idx_cost_ledger_created_at ON cost_ledger(created_at);

-- Tenant discovery budgets (monthly run starts per workspace)
CREATE TABLE IF NOT EXISTS org_discovery_budgets (
    org_id TEXT NOT NULL,
    month TEXT NOT NULL,
    monthly_run_limit INTEGER NOT NULL CHECK(monthly_run_limit >= 0),
    used_runs INTEGER NOT NULL DEFAULT 0 CHECK(used_runs >= 0),
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (org_id, month)
);
CREATE INDEX IF NOT EXISTS idx_org_discovery_budgets_org ON org_discovery_budgets(org_id);

-- Discovery schedules (autonomous pipeline targets)
CREATE TABLE IF NOT EXISTS discovery_schedules (
    id TEXT PRIMARY KEY,
    location_query TEXT NOT NULL,
    state TEXT NOT NULL,
    issue_areas TEXT NOT NULL,
    search_depth TEXT NOT NULL DEFAULT 'standard' CHECK(search_depth IN ('standard', 'deep')),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_id TEXT REFERENCES discovery_runs(id),
    last_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_discovery_schedules_enabled ON discovery_schedules(enabled);
CREATE INDEX IF NOT EXISTS idx_discovery_schedules_state ON discovery_schedules(state);

-- Slug aliases (for vanity slug redirects)
CREATE TABLE IF NOT EXISTS slug_aliases (
    old_slug TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_slug_aliases_entry_id ON slug_aliases(entry_id);

-- Geocoding columns on entries (additive, idempotent).
-- latitude/longitude place each actor on the map; geocode_precision records how
-- confidently we know where they are (rooftop > city > state); geocode_source
-- records who told us. NULL coordinates mean "no location" — such actors are
-- honestly excluded from the map rather than guessed onto it.
ALTER TABLE entries ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS geocode_precision TEXT;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS geocode_source TEXT;
CREATE INDEX IF NOT EXISTS idx_entries_lat_lng ON entries(latitude, longitude);

-- Subject-managed columns on entries (additive, idempotent).
ALTER TABLE entries ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS custom_bio TEXT;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS claim_status TEXT NOT NULL DEFAULT 'unclaimed';
ALTER TABLE entries ADD COLUMN IF NOT EXISTS claimed_by_user_id TEXT;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS claim_verified_at TIMESTAMPTZ;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS last_confirmed_at TIMESTAMPTZ;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS suppressed_source_ids TEXT;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS preferred_contact_channel TEXT;
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE table_name = 'entries' AND constraint_name = 'entries_claim_status_check'
    ) THEN
        ALTER TABLE entries ADD CONSTRAINT entries_claim_status_check
            CHECK (claim_status IN ('unclaimed', 'pending', 'verified', 'revoked'));
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_entries_claim_status ON entries(claim_status);
CREATE INDEX IF NOT EXISTS idx_entries_claimed_by ON entries(claimed_by_user_id);

-- Profile claims (subject ownership of profiles)
CREATE TABLE IF NOT EXISTS profile_claims (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'verified', 'rejected', 'revoked')),
    tier INTEGER NOT NULL DEFAULT 1 CHECK(tier IN (1, 2)),
    evidence_json TEXT,
    verification_token TEXT,
    verification_token_expires_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    rejected_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS profile_claim_proofs (
    id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL REFERENCES profile_claims(id) ON DELETE CASCADE,
    proof_type TEXT NOT NULL CHECK(proof_type IN ('email_domain', 'domain_dns', 'manual_review', 'atproto', 'w3c_vc', 'sso_admin', 'delegate_approval')),
    proof_status TEXT NOT NULL CHECK(proof_status IN ('pending', 'verified', 'rejected', 'revoked')),
    proof_summary TEXT NOT NULL,
    proof_metadata_json TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    reviewed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_profile_claims_entry ON profile_claims(entry_id);
CREATE INDEX IF NOT EXISTS idx_profile_claims_user ON profile_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_claims_status ON profile_claims(status);
CREATE INDEX IF NOT EXISTS idx_profile_claims_token ON profile_claims(verification_token);
CREATE INDEX IF NOT EXISTS idx_profile_claim_proofs_claim ON profile_claim_proofs(claim_id);
CREATE INDEX IF NOT EXISTS idx_profile_claim_proofs_type ON profile_claim_proofs(proof_type);

-- Saved profile lists (signed-in user collections)
CREATE TABLE IF NOT EXISTS saved_lists (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_lists_user ON saved_lists(user_id);

-- List membership (entries pinned to a list)
CREATE TABLE IF NOT EXISTS saved_list_items (
    list_id TEXT NOT NULL REFERENCES saved_lists(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    note TEXT,
    added_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (list_id, entry_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_list_items_entry ON saved_list_items(entry_id);

-- Profile follow subscriptions (notify on new sources)
CREATE TABLE IF NOT EXISTS profile_follows (
    user_id TEXT NOT NULL,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    subscribed_to TEXT NOT NULL DEFAULT 'sources' CHECK(subscribed_to IN ('sources', 'all')),
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, entry_id)
);
CREATE INDEX IF NOT EXISTS idx_profile_follows_entry ON profile_follows(entry_id);
CREATE INDEX IF NOT EXISTS idx_profile_follows_user ON profile_follows(user_id);
