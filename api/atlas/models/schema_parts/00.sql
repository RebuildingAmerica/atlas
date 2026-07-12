-- Atlas PostgreSQL Schema
-- Idempotent: safe to run multiple times.

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
    full_address TEXT,
    website TEXT,
    email TEXT,
    phone TEXT,
    social_media TEXT,
    affiliated_org_id TEXT REFERENCES entries(id),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    last_verified DATE,
    contact_status TEXT NOT NULL DEFAULT 'not_contacted' CHECK(contact_status IN ('not_contacted', 'contacted', 'responded', 'confirmed', 'declined')),
    editorial_notes TEXT,
    priority TEXT CHECK(priority IS NULL OR priority IN ('high', 'medium', 'low')),
    linked_atproto_did TEXT,
    linked_atproto_handle TEXT,
    linked_atproto_verified_at TIMESTAMPTZ,
    first_seen DATE NOT NULL,
    last_seen DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    slug TEXT UNIQUE,
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))
    ) STORED
);
ALTER TABLE entries ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))
) STORED;

-- Sources table (web sources, articles, etc.)
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    url TEXT UNIQUE NOT NULL,
    title TEXT,
    publication TEXT,
    published_date DATE,
    type TEXT NOT NULL CHECK(type IN ('news_article', 'op_ed', 'podcast', 'academic_paper', 'government_record', 'social_media', 'community_archive', 'org_website', 'conference', 'video', 'report', 'other')),
    ingested_at TIMESTAMPTZ NOT NULL,
    extraction_method TEXT NOT NULL CHECK(extraction_method IN ('manual', 'ai_assisted', 'autodiscovery')),
    raw_content TEXT,
    created_at TIMESTAMPTZ NOT NULL
);

-- Junction: entries to sources (many-to-many)
CREATE TABLE IF NOT EXISTS entry_sources (
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    extraction_context TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (entry_id, source_id)
);

-- Junction: entries to issue areas (many-to-many)
CREATE TABLE IF NOT EXISTS entry_issue_areas (
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    issue_area TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (entry_id, issue_area)
);

-- Stable identity keys keep repeated public mentions attached to one actor.
CREATE TABLE IF NOT EXISTS entity_identity_keys (
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    key_type TEXT NOT NULL CHECK(key_type IN ('ein', 'fec_id', 'domain')),
    key_value TEXT NOT NULL,
    source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (key_type, key_value)
);

-- Sourced relationship edges make the profile network inspectable and durable.
CREATE TABLE IF NOT EXISTS entity_relationship_edges (
    id TEXT PRIMARY KEY,
    source_entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    target_entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    evidence_label TEXT NOT NULL,
    confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
    evidence_count INTEGER NOT NULL DEFAULT 1 CHECK(evidence_count > 0),
    first_seen TIMESTAMPTZ NOT NULL,
    last_seen TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CHECK(source_entry_id <> target_entry_id),
    UNIQUE(source_entry_id, target_entry_id, relationship_type, source_id)
);

-- Outreach log (internal)
CREATE TABLE IF NOT EXISTS outreach_logs (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    date TIMESTAMPTZ NOT NULL,
    method TEXT NOT NULL CHECK(method IN ('email', 'phone', 'social_media', 'in_person', 'other')),
    notes TEXT,
    response TEXT CHECK(response IS NULL OR response IN ('no_response', 'positive', 'negative', 'deferred')),
    created_at TIMESTAMPTZ NOT NULL
);

-- Episode associations (internal)
CREATE TABLE IF NOT EXISTS episode_associations (
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    episode TEXT NOT NULL,
    role TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (entry_id, episode)
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
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS discovery_run_syncs (
    id TEXT PRIMARY KEY,
    local_run_id TEXT NOT NULL,
    artifact_hash TEXT NOT NULL,
    remote_run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
    actor_user_id TEXT NOT NULL,
    actor_email TEXT,
    sync_status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    synced_at TIMESTAMPTZ,
    UNIQUE(local_run_id, artifact_hash)
);

-- Entity flags (anonymous public flagging)
CREATE TABLE IF NOT EXISTS entity_flags (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'reviewed', 'resolved')),
    created_at TIMESTAMPTZ NOT NULL
);

-- Source flags (anonymous public flagging)
CREATE TABLE IF NOT EXISTS source_flags (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'reviewed', 'resolved')),
    created_at TIMESTAMPTZ NOT NULL
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
    dedup_suspect BOOLEAN NOT NULL DEFAULT FALSE,
    dedup_note TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_entity_id ON review_queue(entity_id);
ALTER TABLE review_queue ADD COLUMN IF NOT EXISTS org_id TEXT;
CREATE INDEX IF NOT EXISTS idx_review_queue_org_status ON review_queue(org_id, status);

-- Resource ownership (organization attribution and visibility)
CREATE TABLE IF NOT EXISTS resource_ownership (
    resource_id TEXT NOT NULL,
    resource_type TEXT NOT NULL CHECK(resource_type IN ('entry', 'source', 'discovery_run')),
    org_id TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'private')),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (resource_id, resource_type)
);

-- Organization annotations (private notes on shared entries)
CREATE TABLE IF NOT EXISTS org_annotations (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    entry_id TEXT REFERENCES entries(id),
    source_id TEXT REFERENCES sources(id),
    target_type TEXT NOT NULL DEFAULT 'entry' CHECK(target_type IN ('entry', 'source')),
    target_id TEXT,
    content TEXT NOT NULL,
    author_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE org_annotations ALTER COLUMN entry_id DROP NOT NULL;
ALTER TABLE org_annotations ADD COLUMN IF NOT EXISTS source_id TEXT REFERENCES sources(id);
ALTER TABLE org_annotations ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'entry';
ALTER TABLE org_annotations ADD COLUMN IF NOT EXISTS target_id TEXT;
UPDATE org_annotations SET target_id = entry_id WHERE target_id IS NULL AND entry_id IS NOT NULL;

-- Verified custom domains for public workspace directories.
CREATE TABLE IF NOT EXISTS org_directory_domains (
    org_id TEXT PRIMARY KEY,
    domain TEXT NOT NULL UNIQUE,
    verification_token TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'verified')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ
);

-- Editable public directory configuration for workspace-published directories.
CREATE TABLE IF NOT EXISTS org_directory_configs (
    org_id TEXT PRIMARY KEY,
    title TEXT,
    sponsor_label TEXT,
    issue_area_ids_json TEXT NOT NULL DEFAULT '[]',
    geography_labels_json TEXT NOT NULL DEFAULT '[]',
    entry_types_json TEXT NOT NULL DEFAULT '[]',
    methodology_summary TEXT,
    source_policy TEXT,
    review_policy TEXT,
    correction_policy TEXT,
    correction_path_template TEXT,
    missing_context_path_template TEXT,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Private Atlas Brief artifacts saved inside a workspace.
CREATE TABLE IF NOT EXISTS org_briefs (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    title TEXT NOT NULL,
    scope_json TEXT NOT NULL,
    summary TEXT NOT NULL,
    linked_entry_ids_json TEXT NOT NULL,
    linked_source_ids_json TEXT NOT NULL,
    linked_discovery_run_ids_json TEXT NOT NULL,
    confidence_summary_json TEXT NOT NULL,
    gaps_json TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Coverage targets define workspace-scoped coverage expectations and status.
CREATE TABLE IF NOT EXISTS org_coverage_targets (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    geography TEXT NOT NULL,
    issue_areas_json TEXT NOT NULL,
    actor_types_json TEXT NOT NULL,
    source_types_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('covered', 'thin', 'unknown', 'stale', 'blocked')),
    status_reason TEXT NOT NULL,
    review_state TEXT NOT NULL DEFAULT 'needs_research'
        CHECK(review_state IN ('needs_research', 'in_review', 'ready_for_delivery')),
    gaps_json TEXT NOT NULL,
    next_actions_json TEXT NOT NULL,
    records_found INTEGER NOT NULL DEFAULT 0,
    sources_reviewed INTEGER NOT NULL DEFAULT 0,
    last_run_at TIMESTAMPTZ,
    last_reviewed_at TIMESTAMPTZ,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS org_coverage_target_runs (
    target_id TEXT NOT NULL REFERENCES org_coverage_targets(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (target_id, run_id)
);

CREATE TABLE IF NOT EXISTS org_coverage_target_entries (
    target_id TEXT NOT NULL REFERENCES org_coverage_targets(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (target_id, entry_id)
);
