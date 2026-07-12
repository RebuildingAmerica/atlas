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
    event_type TEXT NOT NULL CHECK(event_type IN ('new_source', 'profile_updated', 'relationship_added', 'coverage_status_changed', 'correction', 'civic_signal')),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
    coverage_target_id TEXT REFERENCES org_coverage_targets(id) ON DELETE SET NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Firehose observations, source targets, artifacts, signals, and routes.
CREATE TABLE IF NOT EXISTS firehose_observations (
    id TEXT PRIMARY KEY,
    producer TEXT NOT NULL CHECK(producer IN (
        'source_target', 'discovery_sync', 'catalog', 'profile_claim', 'review'
    )),
    observation_type TEXT NOT NULL CHECK(observation_type IN (
        'watched_source_artifact',
        'actor_discovered',
        'source_attached',
        'relationship_observed',
        'profile_claimed',
        'review_decision',
        'coverage_gap'
    )),
    subject_type TEXT NOT NULL,
    subject_id TEXT,
    org_id TEXT,
    coverage_target_id TEXT REFERENCES org_coverage_targets(id) ON DELETE SET NULL,
    places_json TEXT NOT NULL DEFAULT '[]',
    issues_json TEXT NOT NULL DEFAULT '[]',
    source_class TEXT,
    occurred_at TIMESTAMPTZ,
    observed_at TIMESTAMPTZ NOT NULL,
    dedupe_key TEXT NOT NULL,
    public_realm_basis TEXT NOT NULL,
    confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
    sensitivity REAL NOT NULL CHECK(sensitivity >= 0 AND sensitivity <= 1),
    payload_json TEXT NOT NULL DEFAULT '{}',
    evidence_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'observed'
        CHECK(status IN ('observed', 'signals_created', 'ignored', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(producer, dedupe_key)
);

CREATE TABLE IF NOT EXISTS firehose_observation_deliveries (
    id TEXT PRIMARY KEY,
    observation_id TEXT NOT NULL REFERENCES firehose_observations(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'claimed', 'delivered', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
    claimed_by TEXT,
    claimed_until TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL,
    last_error TEXT,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(observation_id)
);

CREATE TABLE IF NOT EXISTS firehose_source_targets (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    coverage_target_id TEXT NOT NULL REFERENCES org_coverage_targets(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    url TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('rss', 'atom', 'web_page')),
    source_class TEXT NOT NULL,
    places_json TEXT NOT NULL DEFAULT '[]',
    issues_json TEXT NOT NULL DEFAULT '[]',
    priority TEXT NOT NULL DEFAULT 'hot' CHECK(priority IN ('hot', 'warm')),
    cadence_seconds INTEGER NOT NULL DEFAULT 60 CHECK(cadence_seconds >= 15),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    safety_policy TEXT NOT NULL DEFAULT 'standard'
        CHECK(safety_policy IN ('standard', 'person_review_required', 'review_all')),
    public_route_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual', 'scout_sync', 'api', 'system')),
    origin_note TEXT,
    last_checked_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_error TEXT,
    last_http_status INTEGER,
    etag TEXT,
    last_modified TEXT,
    content_hash TEXT,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, coverage_target_id, url)
);

CREATE TABLE IF NOT EXISTS firehose_artifacts (
    id TEXT PRIMARY KEY,
    source_target_id TEXT NOT NULL REFERENCES firehose_source_targets(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    coverage_target_id TEXT NOT NULL REFERENCES org_coverage_targets(id) ON DELETE CASCADE,
    source_url TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    title TEXT NOT NULL,
    publisher TEXT,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('rss', 'atom', 'web_page')),
    source_class TEXT NOT NULL,
    published_at TIMESTAMPTZ,
    detected_at TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL,
    content_hash TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    relevant_text TEXT NOT NULL,
    raw_content TEXT,
    http_status INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source_target_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS firehose_signals (
    id TEXT PRIMARY KEY,
    artifact_id TEXT REFERENCES firehose_artifacts(id) ON DELETE SET NULL,
    primary_observation_id TEXT REFERENCES firehose_observations(id) ON DELETE SET NULL,
    signal_key TEXT,
    org_id TEXT NOT NULL,
    coverage_target_id TEXT REFERENCES org_coverage_targets(id) ON DELETE SET NULL,
    signal_type TEXT NOT NULL CHECK(signal_type IN (
        'public_meeting',
        'public_comment',
        'vote',
        'filing',
        'grant_award',
        'coalition_activity',
        'new_source',
        'role_change',
        'freshness_change',
        'actor_discovered',
        'source_attached',
        'relationship_observed',
        'profile_claimed',
        'review_decision',
        'coverage_gap'
    )),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    occurred_at TIMESTAMPTZ,
    detected_at TIMESTAMPTZ NOT NULL,
    public_realm_basis TEXT NOT NULL,
    places_json TEXT NOT NULL DEFAULT '[]',
    issues_json TEXT NOT NULL DEFAULT '[]',
    actors_json TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
    sensitivity REAL NOT NULL CHECK(sensitivity >= 0 AND sensitivity <= 1),
    review_state TEXT NOT NULL CHECK(review_state IN (
        'not_required', 'pending', 'approved', 'held', 'rejected'
    )),
    visibility TEXT NOT NULL CHECK(visibility IN ('workspace', 'partner', 'public', 'reviewer')),
    route_state TEXT NOT NULL DEFAULT 'pending'
        CHECK(route_state IN ('pending', 'routed', 'held_for_review', 'rejected', 'suppressed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(artifact_id, signal_type)
);

CREATE TABLE IF NOT EXISTS firehose_signal_observations (
    signal_id TEXT NOT NULL REFERENCES firehose_signals(id) ON DELETE CASCADE,
    observation_id TEXT NOT NULL REFERENCES firehose_observations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('primary', 'supporting')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (signal_id, observation_id)
);

CREATE TABLE IF NOT EXISTS firehose_routes (
    id TEXT PRIMARY KEY,
    signal_id TEXT NOT NULL REFERENCES firehose_signals(id) ON DELETE CASCADE,
    destination_type TEXT NOT NULL CHECK(destination_type IN (
        'workspace', 'profile', 'place', 'issue', 'public', 'review'
    )),
    destination_id TEXT,
    state TEXT NOT NULL CHECK(state IN ('active', 'held', 'suppressed')),
    route_reason TEXT NOT NULL,
    routed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workspace usage events power non-invasive renewal summaries.
CREATE TABLE IF NOT EXISTS org_usage_events (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    actor_id TEXT,
    event_type TEXT NOT NULL CHECK(event_type IN ('brief_opened', 'brief_exported', 'evidence_opened', 'list_item_saved', 'watch_created', 'coverage_report_exported', 'coverage_target_created', 'scout_artifacts_synced', 'digest_viewed', 'coverage_gap_closed', 'api_call', 'public_record_improved')),
    resource_type TEXT CHECK(resource_type IS NULL OR resource_type IN ('brief', 'source', 'saved_list', 'watch', 'digest', 'coverage_target', 'coverage_report', 'discovery_run', 'api', 'public_record')),
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
CREATE INDEX IF NOT EXISTS idx_discovery_run_syncs_local_run_id ON discovery_run_syncs(local_run_id);
CREATE INDEX IF NOT EXISTS idx_discovery_run_syncs_remote_run_id ON discovery_run_syncs(remote_run_id);
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
CREATE INDEX IF NOT EXISTS idx_firehose_source_targets_org
    ON firehose_source_targets(org_id, coverage_target_id);
CREATE INDEX IF NOT EXISTS idx_firehose_observations_org_observed
    ON firehose_observations(org_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_firehose_observations_subject
    ON firehose_observations(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_firehose_observation_deliveries_due
    ON firehose_observation_deliveries(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_firehose_observation_deliveries_observation
    ON firehose_observation_deliveries(observation_id);
CREATE INDEX IF NOT EXISTS idx_firehose_source_targets_due
    ON firehose_source_targets(enabled, priority, updated_at);
CREATE INDEX IF NOT EXISTS idx_firehose_artifacts_target_detected
    ON firehose_artifacts(source_target_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_firehose_artifacts_coverage_detected
    ON firehose_artifacts(org_id, coverage_target_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_firehose_signals_org_detected
    ON firehose_signals(org_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_firehose_signals_coverage_detected
    ON firehose_signals(org_id, coverage_target_id, detected_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_firehose_signals_signal_key
    ON firehose_signals(org_id, signal_key);
CREATE INDEX IF NOT EXISTS idx_firehose_routes_signal
    ON firehose_routes(signal_id);
CREATE INDEX IF NOT EXISTS idx_firehose_signal_observations_observation
    ON firehose_signal_observations(observation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_firehose_routes_once
    ON firehose_routes(signal_id, destination_type, COALESCE(destination_id, ''));
CREATE INDEX IF NOT EXISTS idx_org_usage_events_org_created
    ON org_usage_events(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_org_usage_events_org_type
    ON org_usage_events(org_id, event_type);
