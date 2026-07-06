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

-- Workspace watches let teams monitor actors and coverage targets.
CREATE TABLE IF NOT EXISTS org_watches (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    resource_type TEXT NOT NULL CHECK(resource_type IN ('entry', 'coverage_target')),
    resource_id TEXT NOT NULL,
    notification_preference TEXT NOT NULL DEFAULT 'digest' CHECK(notification_preference IN ('digest', 'immediate', 'muted')),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, resource_type, resource_id)
);

-- Workspace watch events power in-app monitoring digests.
CREATE TABLE IF NOT EXISTS org_change_events (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    resource_type TEXT NOT NULL CHECK(resource_type IN ('entry', 'coverage_target')),
    resource_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type IN ('new_source', 'profile_updated', 'relationship_added', 'coverage_status_changed', 'correction')),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
    coverage_target_id TEXT REFERENCES org_coverage_targets(id) ON DELETE SET NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workspace usage events power non-invasive renewal summaries.
CREATE TABLE IF NOT EXISTS org_usage_events (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    actor_id TEXT,
    event_type TEXT NOT NULL CHECK(event_type IN ('brief_opened', 'brief_exported', 'evidence_opened', 'list_item_saved', 'watch_created', 'digest_viewed', 'coverage_gap_closed', 'api_call', 'public_record_improved')),
    resource_type TEXT CHECK(resource_type IS NULL OR resource_type IN ('brief', 'source', 'saved_list', 'watch', 'digest', 'coverage_target', 'api', 'public_record')),
    resource_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
ALTER TABLE entries ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))
) STORED;
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
CREATE INDEX IF NOT EXISTS idx_entity_identity_keys_entry ON entity_identity_keys(entry_id);
CREATE INDEX IF NOT EXISTS idx_entity_identity_keys_source ON entity_identity_keys(source_id);
CREATE INDEX IF NOT EXISTS idx_entity_relationship_edges_source_entry ON entity_relationship_edges(source_entry_id);
CREATE INDEX IF NOT EXISTS idx_entity_relationship_edges_target_entry ON entity_relationship_edges(target_entry_id);
CREATE INDEX IF NOT EXISTS idx_entity_relationship_edges_source ON entity_relationship_edges(source_id);
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
CREATE INDEX IF NOT EXISTS idx_resource_ownership_org ON resource_ownership(org_id);
CREATE INDEX IF NOT EXISTS idx_resource_ownership_org_visibility ON resource_ownership(org_id, visibility);
CREATE INDEX IF NOT EXISTS idx_org_annotations_org ON org_annotations(org_id);
CREATE INDEX IF NOT EXISTS idx_org_annotations_entry ON org_annotations(entry_id);
CREATE INDEX IF NOT EXISTS idx_org_annotations_source ON org_annotations(source_id);
CREATE INDEX IF NOT EXISTS idx_org_annotations_target ON org_annotations(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_org_directory_domains_status ON org_directory_domains(status);
CREATE INDEX IF NOT EXISTS idx_org_directory_configs_updated ON org_directory_configs(updated_at);
CREATE INDEX IF NOT EXISTS idx_org_briefs_org ON org_briefs(org_id);
CREATE INDEX IF NOT EXISTS idx_org_briefs_updated ON org_briefs(updated_at);
CREATE INDEX IF NOT EXISTS idx_org_coverage_targets_org ON org_coverage_targets(org_id);
CREATE INDEX IF NOT EXISTS idx_org_coverage_targets_status ON org_coverage_targets(status);
CREATE INDEX IF NOT EXISTS idx_org_coverage_target_runs_run ON org_coverage_target_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_org_coverage_target_entries_entry ON org_coverage_target_entries(entry_id);
CREATE INDEX IF NOT EXISTS idx_org_watches_org ON org_watches(org_id);
CREATE INDEX IF NOT EXISTS idx_org_watches_resource ON org_watches(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_org_change_events_org_created ON org_change_events(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_org_change_events_resource ON org_change_events(resource_type, resource_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_change_events_source_once
    ON org_change_events(org_id, resource_type, resource_id, event_type, source_id)
    WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_usage_events_org_created
    ON org_usage_events(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_org_usage_events_org_type
    ON org_usage_events(org_id, event_type);

-- Public place page context. These rows hold human-facing civic geography
-- context that complements actor/source search results.
CREATE TABLE IF NOT EXISTS place_contexts (
    place_key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('polity', 'borough', 'city', 'county', 'metro', 'neighborhood', 'district', 'service_area', 'state')),
    source_dataset TEXT,
    source_identifier TEXT,
    source_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS place_scope_links (
    place_key TEXT NOT NULL REFERENCES place_contexts(place_key) ON DELETE CASCADE,
    label TEXT NOT NULL,
    href TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (place_key, href)
);

CREATE TABLE IF NOT EXISTS place_query_filters (
    id TEXT PRIMARY KEY,
    place_key TEXT NOT NULL REFERENCES place_contexts(place_key) ON DELETE CASCADE,
    city TEXT,
    state TEXT,
    region TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS place_summary_facts (
    place_key TEXT NOT NULL REFERENCES place_contexts(place_key) ON DELETE CASCADE,
    label TEXT NOT NULL,
    value TEXT NOT NULL,
    attribution TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (place_key, label)
);

CREATE TABLE IF NOT EXISTS place_governments (
    id TEXT PRIMARY KEY,
    place_key TEXT NOT NULL REFERENCES place_contexts(place_key) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS place_government_links (
    government_id TEXT NOT NULL REFERENCES place_governments(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    href TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (government_id, href)
);

CREATE TABLE IF NOT EXISTS place_related_places (
    id TEXT PRIMARY KEY,
    place_key TEXT NOT NULL REFERENCES place_contexts(place_key) ON DELETE CASCADE,
    name TEXT NOT NULL,
    href TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('polity', 'borough', 'city', 'county', 'metro', 'neighborhood', 'district', 'service_area', 'state')),
    source_dataset TEXT,
    source_identifier TEXT,
    source_url TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    summary TEXT NOT NULL,
    accent TEXT NOT NULL CHECK(accent IN ('climate', 'democracy', 'education', 'health', 'housing', 'labor', 'neutral')),
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_place_scope_links_place ON place_scope_links(place_key);
CREATE INDEX IF NOT EXISTS idx_place_query_filters_place ON place_query_filters(place_key);
CREATE INDEX IF NOT EXISTS idx_place_summary_facts_place ON place_summary_facts(place_key);
CREATE INDEX IF NOT EXISTS idx_place_governments_place ON place_governments(place_key);
CREATE INDEX IF NOT EXISTS idx_place_government_links_government
    ON place_government_links(government_id);
CREATE INDEX IF NOT EXISTS idx_place_related_places_place ON place_related_places(place_key);
ALTER TABLE place_related_places ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE place_related_places ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE place_related_places ADD COLUMN IF NOT EXISTS source_dataset TEXT;
ALTER TABLE place_related_places ADD COLUMN IF NOT EXISTS source_identifier TEXT;
ALTER TABLE place_related_places ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE place_contexts ADD COLUMN IF NOT EXISTS source_dataset TEXT;
ALTER TABLE place_contexts ADD COLUMN IF NOT EXISTS source_identifier TEXT;
ALTER TABLE place_contexts ADD COLUMN IF NOT EXISTS source_url TEXT;

INSERT INTO place_contexts (
    place_key, name, display, kind, source_dataset, source_identifier, source_url
)
VALUES (
    'las-vegas-nv',
    'Las Vegas',
    'Las Vegas, NV',
    'polity',
    'Atlas civic place composition',
    'atlas:place-composition/las-vegas-nv',
    NULL
)
ON CONFLICT (place_key) DO UPDATE SET
    name = EXCLUDED.name,
    display = EXCLUDED.display,
    kind = EXCLUDED.kind,
    source_dataset = EXCLUDED.source_dataset,
    source_identifier = EXCLUDED.source_identifier,
    source_url = EXCLUDED.source_url,
    updated_at = NOW();

INSERT INTO place_contexts (
    place_key, name, display, kind, source_dataset, source_identifier, source_url
)
VALUES
    (
        'city:las-vegas-nv',
        'City of Las Vegas',
        'City of Las Vegas, NV',
        'city',
        'U.S. Census Bureau Places',
        'census:place/3240000',
        'https://www.census.gov/quickfacts/fact/table/lasvegascitynevada/PST045225'
    ),
    (
        'county:clark-county-nv',
        'Clark County',
        'Clark County, NV',
        'county',
        'U.S. Census Bureau Counties',
        'census:county/32003',
        'https://www.census.gov/quickfacts/fact/table/clarkcountynevada/PST045225'
    ),
    (
        'metro:las-vegas-henderson-paradise-nv',
        'Las Vegas-Henderson-Paradise Metro',
        'Las Vegas-Henderson-Paradise, NV Metro Area',
        'metro',
        'U.S. Office of Management and Budget Core Based Statistical Areas',
        'omb:cbsa/29820',
        'https://www.whitehouse.gov/wp-content/uploads/2023/07/OMB-Bulletin-23-01.pdf'
    ),
    (
        'city:henderson-nv',
        'Henderson',
        'Henderson, NV',
        'city',
        'U.S. Census Bureau Places',
        'census:place/3231900',
        'https://www.census.gov/programs-surveys/geography.html'
    ),
    (
        'city:north-las-vegas-nv',
        'North Las Vegas',
        'North Las Vegas, NV',
        'city',
        'U.S. Census Bureau Places',
        'census:place/3251800',
        'https://www.census.gov/programs-surveys/geography.html'
    )
ON CONFLICT (place_key) DO UPDATE SET
    name = EXCLUDED.name,
    display = EXCLUDED.display,
    kind = EXCLUDED.kind,
    source_dataset = EXCLUDED.source_dataset,
    source_identifier = EXCLUDED.source_identifier,
    source_url = EXCLUDED.source_url,
    updated_at = NOW();

INSERT INTO place_scope_links (place_key, label, href, active, sort_order)
VALUES
    ('las-vegas-nv', 'Valley', '/places/las-vegas-nv', TRUE, 10),
    ('las-vegas-nv', 'City', '/places/cities/las-vegas-nv', FALSE, 20),
    ('las-vegas-nv', 'Clark County', '/places/counties/clark-county-nv', FALSE, 30),
    ('las-vegas-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', FALSE, 40),
    ('las-vegas-nv', 'Henderson', '/places/cities/henderson-nv', FALSE, 50),
    ('las-vegas-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', FALSE, 60)
ON CONFLICT (place_key, href) DO UPDATE SET
    label = EXCLUDED.label,
    active = EXCLUDED.active,
    sort_order = EXCLUDED.sort_order;

INSERT INTO place_scope_links (place_key, label, href, active, sort_order)
VALUES
    ('city:las-vegas-nv', 'Valley', '/places/las-vegas-nv', FALSE, 10),
    ('city:las-vegas-nv', 'City', '/places/cities/las-vegas-nv', TRUE, 20),
    ('city:las-vegas-nv', 'Clark County', '/places/counties/clark-county-nv', FALSE, 30),
    ('city:las-vegas-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', FALSE, 40),
    ('city:las-vegas-nv', 'Henderson', '/places/cities/henderson-nv', FALSE, 50),
    ('city:las-vegas-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', FALSE, 60),
    ('county:clark-county-nv', 'Valley', '/places/las-vegas-nv', FALSE, 10),
    ('county:clark-county-nv', 'City', '/places/cities/las-vegas-nv', FALSE, 20),
    ('county:clark-county-nv', 'Clark County', '/places/counties/clark-county-nv', TRUE, 30),
    ('county:clark-county-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', FALSE, 40),
    ('county:clark-county-nv', 'Henderson', '/places/cities/henderson-nv', FALSE, 50),
    ('county:clark-county-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', FALSE, 60),
    ('metro:las-vegas-henderson-paradise-nv', 'Valley', '/places/las-vegas-nv', FALSE, 10),
    ('metro:las-vegas-henderson-paradise-nv', 'City', '/places/cities/las-vegas-nv', FALSE, 20),
    ('metro:las-vegas-henderson-paradise-nv', 'Clark County', '/places/counties/clark-county-nv', FALSE, 30),
    ('metro:las-vegas-henderson-paradise-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', TRUE, 40),
    ('metro:las-vegas-henderson-paradise-nv', 'Henderson', '/places/cities/henderson-nv', FALSE, 50),
    ('metro:las-vegas-henderson-paradise-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', FALSE, 60),
    ('city:henderson-nv', 'Valley', '/places/las-vegas-nv', FALSE, 10),
    ('city:henderson-nv', 'City', '/places/cities/las-vegas-nv', FALSE, 20),
    ('city:henderson-nv', 'Clark County', '/places/counties/clark-county-nv', FALSE, 30),
    ('city:henderson-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', FALSE, 40),
    ('city:henderson-nv', 'Henderson', '/places/cities/henderson-nv', TRUE, 50),
    ('city:henderson-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', FALSE, 60),
    ('city:north-las-vegas-nv', 'Valley', '/places/las-vegas-nv', FALSE, 10),
    ('city:north-las-vegas-nv', 'City', '/places/cities/las-vegas-nv', FALSE, 20),
    ('city:north-las-vegas-nv', 'Clark County', '/places/counties/clark-county-nv', FALSE, 30),
    ('city:north-las-vegas-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', FALSE, 40),
    ('city:north-las-vegas-nv', 'Henderson', '/places/cities/henderson-nv', FALSE, 50),
    ('city:north-las-vegas-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', TRUE, 60)
ON CONFLICT (place_key, href) DO UPDATE SET
    label = EXCLUDED.label,
    active = EXCLUDED.active,
    sort_order = EXCLUDED.sort_order;

INSERT INTO place_query_filters (id, place_key, city, state, region, sort_order)
VALUES
    ('las-vegas-nv-las-vegas', 'las-vegas-nv', 'Las Vegas', 'NV', NULL, 10),
    ('las-vegas-nv-henderson', 'las-vegas-nv', 'Henderson', 'NV', NULL, 20),
    ('las-vegas-nv-north-las-vegas', 'las-vegas-nv', 'North Las Vegas', 'NV', NULL, 30),
    ('city-las-vegas-nv', 'city:las-vegas-nv', 'Las Vegas', 'NV', NULL, 10),
    ('county-clark-county-nv-las-vegas', 'county:clark-county-nv', 'Las Vegas', 'NV', NULL, 10),
    ('county-clark-county-nv-henderson', 'county:clark-county-nv', 'Henderson', 'NV', NULL, 20),
    ('county-clark-county-nv-north-las-vegas', 'county:clark-county-nv', 'North Las Vegas', 'NV', NULL, 30),
    ('metro-las-vegas-henderson-paradise-nv-las-vegas', 'metro:las-vegas-henderson-paradise-nv', 'Las Vegas', 'NV', NULL, 10),
    ('metro-las-vegas-henderson-paradise-nv-henderson', 'metro:las-vegas-henderson-paradise-nv', 'Henderson', 'NV', NULL, 20),
    ('metro-las-vegas-henderson-paradise-nv-north-las-vegas', 'metro:las-vegas-henderson-paradise-nv', 'North Las Vegas', 'NV', NULL, 30),
    ('city-henderson-nv', 'city:henderson-nv', 'Henderson', 'NV', NULL, 10),
    ('city-north-las-vegas-nv', 'city:north-las-vegas-nv', 'North Las Vegas', 'NV', NULL, 10)
ON CONFLICT (id) DO UPDATE SET
    place_key = EXCLUDED.place_key,
    city = EXCLUDED.city,
    state = EXCLUDED.state,
    region = EXCLUDED.region,
    sort_order = EXCLUDED.sort_order;

INSERT INTO place_summary_facts (place_key, label, value, attribution, sort_order)
VALUES
    ('las-vegas-nv', 'Metro', 'Las Vegas-Henderson-Paradise', NULL, 10),
    ('las-vegas-nv', 'County', 'Clark County', NULL, 20),
    ('las-vegas-nv', 'Valley cities', 'Las Vegas, Henderson, North Las Vegas', NULL, 30),
    ('las-vegas-nv', 'Largest work base', 'Tourism, service, logistics', NULL, 40),
    ('las-vegas-nv', 'Active issues', 'Housing, transit, heat, water', NULL, 50)
ON CONFLICT (place_key, label) DO UPDATE SET
    value = EXCLUDED.value,
    attribution = EXCLUDED.attribution,
    sort_order = EXCLUDED.sort_order;

INSERT INTO place_governments (id, place_key, name, role, sort_order)
VALUES
    ('las-vegas-nv-city', 'las-vegas-nv', 'City of Las Vegas', 'Mayor and council, city budget, planning, public works, city services.', 10),
    ('las-vegas-nv-clark-county', 'las-vegas-nv', 'Clark County', 'County commission, courts, public health, regional services, unincorporated areas.', 20),
    ('las-vegas-nv-rtc', 'las-vegas-nv', 'RTC Southern Nevada', 'Transit planning, bus operations, and regional transportation projects.', 30),
    ('las-vegas-nv-snwa', 'las-vegas-nv', 'Southern Nevada Water Authority', 'Regional water supply, conservation policy, and drought planning.', 40)
ON CONFLICT (id) DO UPDATE SET
    place_key = EXCLUDED.place_key,
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    sort_order = EXCLUDED.sort_order;

INSERT INTO place_government_links (government_id, label, href, sort_order)
VALUES
    ('las-vegas-nv-city', 'Council agendas', 'https://www.lasvegasnevada.gov/Government', 10),
    ('las-vegas-nv-clark-county', 'Commission agendas', 'https://www.clarkcountynv.gov/', 10),
    ('las-vegas-nv-rtc', 'Board meetings', 'https://www.rtcsnv.com/', 10),
    ('las-vegas-nv-snwa', 'Water plans', 'https://www.snwa.com/', 10)
ON CONFLICT (government_id, href) DO UPDATE SET
    label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order;

DELETE FROM place_related_places
WHERE id IN (
    'las-vegas-nv-strip',
    'las-vegas-nv-east-las-vegas',
    'las-vegas-nv-historic-westside',
    'las-vegas-nv-maryland-parkway',
    'las-vegas-nv-boulder-highway'
);

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
