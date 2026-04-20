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
    first_seen DATE NOT NULL,
    last_seen DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))
    ) STORED
);

-- Sources table (web sources, articles, etc.)
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    url TEXT UNIQUE NOT NULL,
    title TEXT,
    publication TEXT,
    published_date DATE,
    type TEXT NOT NULL CHECK(type IN ('news_article', 'op_ed', 'podcast', 'academic_paper', 'government_record', 'social_media', 'org_website', 'conference', 'video', 'report', 'other')),
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
    queries_generated INTEGER NOT NULL DEFAULT 0,
    sources_fetched INTEGER NOT NULL DEFAULT 0,
    sources_processed INTEGER NOT NULL DEFAULT 0,
    entries_extracted INTEGER NOT NULL DEFAULT 0,
    entries_after_dedup INTEGER NOT NULL DEFAULT 0,
    entries_confirmed INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL
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

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_entries_state ON entries(state);
CREATE INDEX IF NOT EXISTS idx_entries_city ON entries(city);
CREATE INDEX IF NOT EXISTS idx_entries_region ON entries(region);
CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);
CREATE INDEX IF NOT EXISTS idx_entries_active ON entries(active);
CREATE INDEX IF NOT EXISTS idx_entries_verified ON entries(verified);
CREATE INDEX IF NOT EXISTS idx_entries_state_city ON entries(state, city);
CREATE INDEX IF NOT EXISTS idx_entries_search ON entries USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_entry_sources_entry_id ON entry_sources(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_sources_source_id ON entry_sources(source_id);
CREATE INDEX IF NOT EXISTS idx_entry_issue_areas_entry_id ON entry_issue_areas(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_issue_areas_issue_area ON entry_issue_areas(issue_area);
CREATE INDEX IF NOT EXISTS idx_outreach_logs_entry_id ON outreach_logs(entry_id);
CREATE INDEX IF NOT EXISTS idx_outreach_logs_date ON outreach_logs(date);
CREATE INDEX IF NOT EXISTS idx_episode_assoc_entry_id ON episode_associations(entry_id);
CREATE INDEX IF NOT EXISTS idx_discovery_runs_state ON discovery_runs(state);
CREATE INDEX IF NOT EXISTS idx_discovery_runs_status ON discovery_runs(status);
CREATE INDEX IF NOT EXISTS idx_sources_url ON sources(url);
CREATE INDEX IF NOT EXISTS idx_sources_ingested ON sources(ingested_at);
CREATE INDEX IF NOT EXISTS idx_entity_flags_entity_id ON entity_flags(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_flags_status ON entity_flags(status);
CREATE INDEX IF NOT EXISTS idx_source_flags_source_id ON source_flags(source_id);
CREATE INDEX IF NOT EXISTS idx_source_flags_status ON source_flags(status);
