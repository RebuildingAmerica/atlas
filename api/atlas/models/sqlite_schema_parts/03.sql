-- Slug aliases (for vanity slug redirects)
CREATE TABLE IF NOT EXISTS slug_aliases (
    old_slug TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_slug_aliases_entry_id ON slug_aliases(entry_id);

-- Keep FTS content synchronized with entries.
CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
    INSERT INTO entries_fts(rowid, name, description)
    VALUES (new.rowid, new.name, new.description);
END;

CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, name, description)
    VALUES ('delete', old.rowid, old.name, old.description);
END;

CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, name, description)
    VALUES ('delete', old.rowid, old.name, old.description);
    INSERT INTO entries_fts(rowid, name, description)
    VALUES (new.rowid, new.name, new.description);
END;

-- Ensure existing rows are discoverable after init_db runs on an existing database.
INSERT INTO entries_fts(entries_fts) VALUES ('rebuild');

CREATE TABLE IF NOT EXISTS firehose_observations (
    id TEXT PRIMARY KEY,
    producer TEXT NOT NULL,
    observation_type TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id TEXT,
    org_id TEXT,
    coverage_target_id TEXT,
    places_json TEXT NOT NULL DEFAULT '[]',
    issues_json TEXT NOT NULL DEFAULT '[]',
    source_class TEXT,
    occurred_at TEXT,
    observed_at TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    public_realm_basis TEXT NOT NULL,
    confidence REAL NOT NULL,
    sensitivity REAL NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    evidence_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (producer, dedupe_key)
);

CREATE TABLE IF NOT EXISTS firehose_observation_deliveries (
    id TEXT PRIMARY KEY,
    observation_id TEXT NOT NULL REFERENCES firehose_observations(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    claimed_by TEXT,
    claimed_until TEXT,
    next_attempt_at TEXT NOT NULL,
    last_error TEXT,
    delivered_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (observation_id)
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
    enabled INTEGER NOT NULL DEFAULT 1,
    safety_policy TEXT NOT NULL DEFAULT 'standard'
        CHECK(safety_policy IN ('standard', 'person_review_required', 'review_all')),
    public_route_enabled INTEGER NOT NULL DEFAULT 0,
    origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual', 'scout_sync', 'api', 'system')),
    origin_note TEXT,
    last_checked_at TEXT,
    last_success_at TEXT,
    last_error TEXT,
    last_http_status INTEGER,
    etag TEXT,
    last_modified TEXT,
    content_hash TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (org_id, coverage_target_id, url)
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
    published_at TEXT,
    detected_at TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    relevant_text TEXT NOT NULL,
    raw_content TEXT,
    http_status INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    UNIQUE (source_target_id, fingerprint)
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
    occurred_at TEXT,
    detected_at TEXT NOT NULL,
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
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (artifact_id, signal_type)
);

CREATE TABLE IF NOT EXISTS firehose_signal_observations (
    signal_id TEXT NOT NULL REFERENCES firehose_signals(id) ON DELETE CASCADE,
    observation_id TEXT NOT NULL REFERENCES firehose_observations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
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
    routed_at TEXT NOT NULL
);

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
