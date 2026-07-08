-- Enable extensions
PRAGMA foreign_keys = ON;

-- Entries table (core entity)
CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('person', 'organization', 'initiative', 'campaign', 'event')),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    city TEXT,
    state TEXT,
    region TEXT,
    geo_specificity TEXT NOT NULL CHECK(geo_specificity IN ('local', 'regional', 'statewide', 'national')),
    latitude REAL,
    longitude REAL,
    geocode_precision TEXT,
    geocode_source TEXT,
    full_address TEXT,
    website TEXT,
    email TEXT,
    phone TEXT,
    social_media TEXT,
    affiliated_org_id TEXT,
    active BOOLEAN NOT NULL DEFAULT 1,
    verified BOOLEAN NOT NULL DEFAULT 0,
    last_verified DATE,
    contact_status TEXT NOT NULL DEFAULT 'not_contacted' CHECK(contact_status IN ('not_contacted', 'contacted', 'responded', 'confirmed', 'declined')),
    editorial_notes TEXT,
    priority TEXT CHECK(priority IS NULL OR priority IN ('high', 'medium', 'low')),
    first_seen DATE NOT NULL,
    last_seen DATE NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    slug TEXT UNIQUE,
    photo_url TEXT,
    custom_bio TEXT,
    claim_status TEXT NOT NULL DEFAULT 'unclaimed' CHECK(claim_status IN ('unclaimed', 'pending', 'verified', 'revoked')),
    claimed_by_user_id TEXT,
    claim_verified_at DATETIME,
    last_confirmed_at DATETIME,
    suppressed_source_ids TEXT,
    preferred_contact_channel TEXT,
    linked_atproto_did TEXT,
    linked_atproto_handle TEXT,
    linked_atproto_verified_at TEXT,
    FOREIGN KEY (affiliated_org_id) REFERENCES entries(id)
);

-- Profile claims (subject ownership of profiles)
CREATE TABLE IF NOT EXISTS profile_claims (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'verified', 'rejected', 'revoked')),
    tier INTEGER NOT NULL DEFAULT 1 CHECK(tier IN (1, 2)),
    evidence_json TEXT,
    verification_token TEXT,
    verification_token_expires_at DATETIME,
    verified_at DATETIME,
    rejected_reason TEXT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- Profile claim proofs (scoped evidence for stewardship decisions)
CREATE TABLE IF NOT EXISTS profile_claim_proofs (
    id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    proof_type TEXT NOT NULL CHECK(proof_type IN ('email_domain', 'domain_dns', 'manual_review', 'atproto', 'w3c_vc', 'sso_admin', 'delegate_approval')),
    proof_status TEXT NOT NULL CHECK(proof_status IN ('pending', 'verified', 'rejected', 'revoked')),
    proof_summary TEXT NOT NULL,
    proof_metadata_json TEXT,
    created_at DATETIME NOT NULL,
    reviewed_at DATETIME,
    expires_at DATETIME,
    FOREIGN KEY (claim_id) REFERENCES profile_claims(id) ON DELETE CASCADE
);

-- Saved profile lists (signed-in user collections)
CREATE TABLE IF NOT EXISTS saved_lists (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);

-- List membership (entries pinned to a list)
CREATE TABLE IF NOT EXISTS saved_list_items (
    list_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    note TEXT,
    added_at DATETIME NOT NULL,
    PRIMARY KEY (list_id, entry_id),
    FOREIGN KEY (list_id) REFERENCES saved_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- Profile follow subscriptions (notify on new sources)
CREATE TABLE IF NOT EXISTS profile_follows (
    user_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    subscribed_to TEXT NOT NULL DEFAULT 'sources' CHECK(subscribed_to IN ('sources', 'all')),
    created_at DATETIME NOT NULL,
    PRIMARY KEY (user_id, entry_id),
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- Sources table (web sources, articles, etc.)
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    url TEXT UNIQUE NOT NULL,
    title TEXT,
    publication TEXT,
    published_date DATE,
    type TEXT NOT NULL CHECK(type IN ('news_article', 'op_ed', 'podcast', 'academic_paper', 'government_record', 'social_media', 'community_archive', 'org_website', 'conference', 'video', 'report', 'other')),
    ingested_at DATETIME NOT NULL,
    extraction_method TEXT NOT NULL CHECK(extraction_method IN ('manual', 'ai_assisted', 'autodiscovery')),
    raw_content TEXT,
    created_at DATETIME NOT NULL
);

-- Junction: entries to sources (many-to-many)
CREATE TABLE IF NOT EXISTS entry_sources (
    entry_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    extraction_context TEXT,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (entry_id, source_id),
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

-- Junction: entries to issue areas (many-to-many)
CREATE TABLE IF NOT EXISTS entry_issue_areas (
    entry_id TEXT NOT NULL,
    issue_area TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (entry_id, issue_area),
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- Stable identity keys keep repeated public mentions attached to one actor.
CREATE TABLE IF NOT EXISTS entity_identity_keys (
    entry_id TEXT NOT NULL,
    key_type TEXT NOT NULL CHECK(key_type IN ('ein', 'fec_id', 'domain')),
    key_value TEXT NOT NULL,
    source_id TEXT,
    confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (key_type, key_value),
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
);

-- Sourced relationship edges make the profile network inspectable and durable.
CREATE TABLE IF NOT EXISTS entity_relationship_edges (
    id TEXT PRIMARY KEY,
    source_entry_id TEXT NOT NULL,
    target_entry_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    evidence_label TEXT NOT NULL,
    confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
    evidence_count INTEGER NOT NULL DEFAULT 1 CHECK(evidence_count > 0),
    first_seen DATETIME NOT NULL,
    last_seen DATETIME NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    CHECK(source_entry_id != target_entry_id),
    UNIQUE(source_entry_id, target_entry_id, relationship_type, source_id),
    FOREIGN KEY (source_entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY (target_entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

-- Outreach log (internal)
CREATE TABLE IF NOT EXISTS outreach_logs (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    date DATETIME NOT NULL,
    method TEXT NOT NULL CHECK(method IN ('email', 'phone', 'social_media', 'in_person', 'other')),
    notes TEXT,
    response TEXT CHECK(response IS NULL OR response IN ('no_response', 'positive', 'negative', 'deferred')),
    created_at DATETIME NOT NULL,
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- Episode associations (internal)
CREATE TABLE IF NOT EXISTS episode_associations (
    entry_id TEXT NOT NULL,
    episode TEXT NOT NULL,
    role TEXT,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (entry_id, episode),
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- Discovery runs (pipeline execution tracking)
CREATE TABLE IF NOT EXISTS discovery_runs (
    id TEXT PRIMARY KEY,
    location_query TEXT NOT NULL,
    state TEXT NOT NULL,
    issue_areas TEXT NOT NULL,
    research_goal TEXT NOT NULL DEFAULT 'landscape_scan',
    queries_generated INTEGER NOT NULL DEFAULT 0,
    sources_fetched INTEGER NOT NULL DEFAULT 0,
    sources_processed INTEGER NOT NULL DEFAULT 0,
    entries_extracted INTEGER NOT NULL DEFAULT 0,
    entries_after_dedup INTEGER NOT NULL DEFAULT 0,
    entries_confirmed INTEGER NOT NULL DEFAULT 0,
    research_summary TEXT,
    started_at DATETIME NOT NULL,
    completed_at DATETIME,
    status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
    error_message TEXT,
    created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS discovery_run_syncs (
    id TEXT PRIMARY KEY,
    local_run_id TEXT NOT NULL,
    artifact_hash TEXT NOT NULL,
    remote_run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
    actor_user_id TEXT NOT NULL,
    actor_email TEXT,
    sync_status TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    synced_at DATETIME,
    UNIQUE(local_run_id, artifact_hash)
);

-- Entity flags (anonymous public flagging)
CREATE TABLE IF NOT EXISTS entity_flags (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'reviewed', 'resolved')),
    created_at DATETIME NOT NULL,
    FOREIGN KEY (entity_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- Source flags (anonymous public flagging)
CREATE TABLE IF NOT EXISTS source_flags (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'reviewed', 'resolved')),
    created_at DATETIME NOT NULL,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

-- Review queue (pre-publication staging for discovered records)
CREATE TABLE IF NOT EXISTS review_queue (
    id TEXT PRIMARY KEY,
    org_id TEXT,
    entity_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    hold_reason TEXT NOT NULL,
    score REAL,
    dedup_suspect BOOLEAN NOT NULL DEFAULT 0,
    dedup_note TEXT,
    created_at DATETIME NOT NULL,
    reviewed_at DATETIME,
    reviewed_by TEXT
);

-- Resource ownership (organization attribution and visibility)
CREATE TABLE IF NOT EXISTS resource_ownership (
    resource_id TEXT NOT NULL,
    resource_type TEXT NOT NULL CHECK(resource_type IN ('entry', 'source', 'discovery_run')),
    org_id TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'private')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (resource_id, resource_type)
);

-- Organization annotations (private notes on shared entries)
CREATE TABLE IF NOT EXISTS org_annotations (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    entry_id TEXT,
    source_id TEXT,
    target_type TEXT NOT NULL DEFAULT 'entry' CHECK(target_type IN ('entry', 'source')),
    target_id TEXT,
    content TEXT NOT NULL,
    author_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (entry_id) REFERENCES entries(id),
    FOREIGN KEY (source_id) REFERENCES sources(id)
);
