INSERT INTO place_scope_links (place_key, label, href, active, sort_order)
VALUES
    ('las-vegas-nv', 'Valley', '/places/las-vegas-nv', 1, 10),
    ('las-vegas-nv', 'City', '/places/cities/las-vegas-nv', 0, 20),
    ('las-vegas-nv', 'Clark County', '/places/counties/clark-county-nv', 0, 30),
    ('las-vegas-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', 0, 40),
    ('las-vegas-nv', 'Henderson', '/places/cities/henderson-nv', 0, 50),
    ('las-vegas-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', 0, 60)
ON CONFLICT (place_key, href) DO UPDATE SET
    label = excluded.label,
    active = excluded.active,
    sort_order = excluded.sort_order;

INSERT INTO place_scope_links (place_key, label, href, active, sort_order)
VALUES
    ('city:las-vegas-nv', 'Valley', '/places/las-vegas-nv', 0, 10),
    ('city:las-vegas-nv', 'City', '/places/cities/las-vegas-nv', 1, 20),
    ('city:las-vegas-nv', 'Clark County', '/places/counties/clark-county-nv', 0, 30),
    ('city:las-vegas-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', 0, 40),
    ('city:las-vegas-nv', 'Henderson', '/places/cities/henderson-nv', 0, 50),
    ('city:las-vegas-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', 0, 60),
    ('county:clark-county-nv', 'Valley', '/places/las-vegas-nv', 0, 10),
    ('county:clark-county-nv', 'City', '/places/cities/las-vegas-nv', 0, 20),
    ('county:clark-county-nv', 'Clark County', '/places/counties/clark-county-nv', 1, 30),
    ('county:clark-county-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', 0, 40),
    ('county:clark-county-nv', 'Henderson', '/places/cities/henderson-nv', 0, 50),
    ('county:clark-county-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', 0, 60),
    ('metro:las-vegas-henderson-paradise-nv', 'Valley', '/places/las-vegas-nv', 0, 10),
    ('metro:las-vegas-henderson-paradise-nv', 'City', '/places/cities/las-vegas-nv', 0, 20),
    ('metro:las-vegas-henderson-paradise-nv', 'Clark County', '/places/counties/clark-county-nv', 0, 30),
    ('metro:las-vegas-henderson-paradise-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', 1, 40),
    ('metro:las-vegas-henderson-paradise-nv', 'Henderson', '/places/cities/henderson-nv', 0, 50),
    ('metro:las-vegas-henderson-paradise-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', 0, 60),
    ('city:henderson-nv', 'Valley', '/places/las-vegas-nv', 0, 10),
    ('city:henderson-nv', 'City', '/places/cities/las-vegas-nv', 0, 20),
    ('city:henderson-nv', 'Clark County', '/places/counties/clark-county-nv', 0, 30),
    ('city:henderson-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', 0, 40),
    ('city:henderson-nv', 'Henderson', '/places/cities/henderson-nv', 1, 50),
    ('city:henderson-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', 0, 60),
    ('city:north-las-vegas-nv', 'Valley', '/places/las-vegas-nv', 0, 10),
    ('city:north-las-vegas-nv', 'City', '/places/cities/las-vegas-nv', 0, 20),
    ('city:north-las-vegas-nv', 'Clark County', '/places/counties/clark-county-nv', 0, 30),
    ('city:north-las-vegas-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', 0, 40),
    ('city:north-las-vegas-nv', 'Henderson', '/places/cities/henderson-nv', 0, 50),
    ('city:north-las-vegas-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', 1, 60)
ON CONFLICT (place_key, href) DO UPDATE SET
    label = excluded.label,
    active = excluded.active,
    sort_order = excluded.sort_order;

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
    place_key = excluded.place_key,
    city = excluded.city,
    state = excluded.state,
    region = excluded.region,
    sort_order = excluded.sort_order;

INSERT INTO place_summary_facts (place_key, label, value, attribution, sort_order)
VALUES
    ('las-vegas-nv', 'Metro', 'Las Vegas-Henderson-Paradise', NULL, 10),
    ('las-vegas-nv', 'County', 'Clark County', NULL, 20),
    ('las-vegas-nv', 'Valley cities', 'Las Vegas, Henderson, North Las Vegas', NULL, 30),
    ('las-vegas-nv', 'Largest work base', 'Tourism, service, logistics', NULL, 40),
    ('las-vegas-nv', 'Active issues', 'Housing, transit, heat, water', NULL, 50)
ON CONFLICT (place_key, label) DO UPDATE SET
    value = excluded.value,
    attribution = excluded.attribution,
    sort_order = excluded.sort_order;

INSERT INTO place_governments (id, place_key, name, role, sort_order)
VALUES
    ('las-vegas-nv-city', 'las-vegas-nv', 'City of Las Vegas', 'Mayor and council, city budget, planning, public works, city services.', 10),
    ('las-vegas-nv-clark-county', 'las-vegas-nv', 'Clark County', 'County commission, courts, public health, regional services, unincorporated areas.', 20),
    ('las-vegas-nv-rtc', 'las-vegas-nv', 'RTC Southern Nevada', 'Transit planning, bus operations, and regional transportation projects.', 30),
    ('las-vegas-nv-snwa', 'las-vegas-nv', 'Southern Nevada Water Authority', 'Regional water supply, conservation policy, and drought planning.', 40)
ON CONFLICT (id) DO UPDATE SET
    place_key = excluded.place_key,
    name = excluded.name,
    role = excluded.role,
    sort_order = excluded.sort_order;

INSERT INTO place_government_links (government_id, label, href, sort_order)
VALUES
    ('las-vegas-nv-city', 'Council agendas', 'https://www.lasvegasnevada.gov/Government', 10),
    ('las-vegas-nv-clark-county', 'Commission agendas', 'https://www.clarkcountynv.gov/', 10),
    ('las-vegas-nv-rtc', 'Board meetings', 'https://www.rtcsnv.com/', 10),
    ('las-vegas-nv-snwa', 'Water plans', 'https://www.snwa.com/', 10)
ON CONFLICT (government_id, href) DO UPDATE SET
    label = excluded.label,
    sort_order = excluded.sort_order;

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
    place_key = excluded.place_key,
    name = excluded.name,
    href = excluded.href,
    kind = excluded.kind,
    source_dataset = excluded.source_dataset,
    source_identifier = excluded.source_identifier,
    source_url = excluded.source_url,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    summary = excluded.summary,
    accent = excluded.accent,
    sort_order = excluded.sort_order;

-- Full-text search virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
    name,
    description,
    content=entries,
    content_rowid=rowid
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_entries_state ON entries(state);
CREATE INDEX IF NOT EXISTS idx_entries_city ON entries(city);
CREATE INDEX IF NOT EXISTS idx_entries_region ON entries(region);
CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);
CREATE INDEX IF NOT EXISTS idx_entries_active ON entries(active);
CREATE INDEX IF NOT EXISTS idx_entries_verified ON entries(verified);
CREATE INDEX IF NOT EXISTS idx_entries_state_city ON entries(state, city);
CREATE INDEX IF NOT EXISTS idx_entries_lat_lng ON entries(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_entry_sources_entry_id ON entry_sources(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_sources_source_id ON entry_sources(source_id);
CREATE INDEX IF NOT EXISTS idx_entry_issue_areas_entry_id ON entry_issue_areas(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_issue_areas_issue_area ON entry_issue_areas(issue_area);
CREATE INDEX IF NOT EXISTS idx_entity_identity_keys_entry ON entity_identity_keys(entry_id);
CREATE INDEX IF NOT EXISTS idx_entity_identity_keys_source ON entity_identity_keys(source_id);
CREATE INDEX IF NOT EXISTS idx_entity_relationship_edges_source_entry
    ON entity_relationship_edges(source_entry_id);
CREATE INDEX IF NOT EXISTS idx_entity_relationship_edges_target_entry
    ON entity_relationship_edges(target_entry_id);
CREATE INDEX IF NOT EXISTS idx_entity_relationship_edges_source
    ON entity_relationship_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_outreach_logs_entry_id ON outreach_logs(entry_id);
CREATE INDEX IF NOT EXISTS idx_outreach_logs_date ON outreach_logs(date);
CREATE INDEX IF NOT EXISTS idx_episode_assoc_entry_id ON episode_associations(entry_id);
CREATE INDEX IF NOT EXISTS idx_discovery_runs_state ON discovery_runs(state);
CREATE INDEX IF NOT EXISTS idx_discovery_runs_status ON discovery_runs(status);
CREATE INDEX IF NOT EXISTS idx_discovery_run_syncs_local_run_id ON discovery_run_syncs(local_run_id);
CREATE INDEX IF NOT EXISTS idx_discovery_run_syncs_remote_run_id ON discovery_run_syncs(remote_run_id);
CREATE INDEX IF NOT EXISTS idx_sources_url ON sources(url);
CREATE INDEX IF NOT EXISTS idx_sources_ingested ON sources(ingested_at);
CREATE INDEX IF NOT EXISTS idx_entity_flags_entity_id ON entity_flags(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_flags_status ON entity_flags(status);
CREATE INDEX IF NOT EXISTS idx_source_flags_source_id ON source_flags(source_id);
CREATE INDEX IF NOT EXISTS idx_source_flags_status ON source_flags(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_entity_id ON review_queue(entity_id);
CREATE INDEX IF NOT EXISTS idx_review_queue_org_status ON review_queue(org_id, status);
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
CREATE INDEX IF NOT EXISTS idx_entries_slug ON entries(slug);
CREATE INDEX IF NOT EXISTS idx_entries_claim_status ON entries(claim_status);
CREATE INDEX IF NOT EXISTS idx_entries_claimed_by ON entries(claimed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_profile_claims_entry ON profile_claims(entry_id);
CREATE INDEX IF NOT EXISTS idx_profile_claims_user ON profile_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_claims_status ON profile_claims(status);
CREATE INDEX IF NOT EXISTS idx_profile_claims_token ON profile_claims(verification_token);
CREATE INDEX IF NOT EXISTS idx_profile_claim_proofs_claim ON profile_claim_proofs(claim_id);
CREATE INDEX IF NOT EXISTS idx_profile_claim_proofs_type ON profile_claim_proofs(proof_type);
CREATE INDEX IF NOT EXISTS idx_saved_lists_user ON saved_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_list_items_entry ON saved_list_items(entry_id);
CREATE INDEX IF NOT EXISTS idx_profile_follows_entry ON profile_follows(entry_id);
CREATE INDEX IF NOT EXISTS idx_profile_follows_user ON profile_follows(user_id);

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
    claimed_until DATETIME,
    idempotency_key TEXT,
    next_attempt_at DATETIME,
    execution_mode TEXT NOT NULL DEFAULT 'search' CHECK(execution_mode IN ('search', 'direct_url')),
    input_payload TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME NOT NULL,
    started_at DATETIME,
    completed_at DATETIME
);
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
    created_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_ledger_run_id ON cost_ledger(run_id);
CREATE INDEX IF NOT EXISTS idx_cost_ledger_created_at ON cost_ledger(created_at);

-- Tenant discovery budgets (monthly run starts per workspace)
CREATE TABLE IF NOT EXISTS org_discovery_budgets (
    org_id TEXT NOT NULL,
    month TEXT NOT NULL,
    monthly_run_limit INTEGER NOT NULL CHECK(monthly_run_limit >= 0),
    used_runs INTEGER NOT NULL DEFAULT 0 CHECK(used_runs >= 0),
    updated_at TEXT NOT NULL,
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
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_id TEXT REFERENCES discovery_runs(id),
    last_run_at DATETIME,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_discovery_schedules_enabled ON discovery_schedules(enabled);
CREATE INDEX IF NOT EXISTS idx_discovery_schedules_state ON discovery_schedules(state);
