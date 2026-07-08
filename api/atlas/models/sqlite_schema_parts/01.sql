-- Verified custom domains for public workspace directories.
CREATE TABLE IF NOT EXISTS org_directory_domains (
    org_id TEXT PRIMARY KEY,
    domain TEXT NOT NULL UNIQUE,
    verification_token TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'verified')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    verified_at TEXT
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
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
    last_run_at TEXT,
    last_reviewed_at TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS org_coverage_target_runs (
    target_id TEXT NOT NULL REFERENCES org_coverage_targets(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (target_id, run_id)
);

CREATE TABLE IF NOT EXISTS org_coverage_target_entries (
    target_id TEXT NOT NULL REFERENCES org_coverage_targets(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

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
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS place_scope_links (
    place_key TEXT NOT NULL,
    label TEXT NOT NULL,
    href TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (place_key, href),
    FOREIGN KEY (place_key) REFERENCES place_contexts(place_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS place_query_filters (
    id TEXT PRIMARY KEY,
    place_key TEXT NOT NULL,
    city TEXT,
    state TEXT,
    region TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (place_key) REFERENCES place_contexts(place_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS place_summary_facts (
    place_key TEXT NOT NULL,
    label TEXT NOT NULL,
    value TEXT NOT NULL,
    attribution TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (place_key, label),
    FOREIGN KEY (place_key) REFERENCES place_contexts(place_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS place_governments (
    id TEXT PRIMARY KEY,
    place_key TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (place_key) REFERENCES place_contexts(place_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS place_government_links (
    government_id TEXT NOT NULL,
    label TEXT NOT NULL,
    href TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (government_id, href),
    FOREIGN KEY (government_id) REFERENCES place_governments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS place_related_places (
    id TEXT PRIMARY KEY,
    place_key TEXT NOT NULL,
    name TEXT NOT NULL,
    href TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('polity', 'borough', 'city', 'county', 'metro', 'neighborhood', 'district', 'service_area', 'state')),
    source_dataset TEXT,
    source_identifier TEXT,
    source_url TEXT,
    latitude REAL,
    longitude REAL,
    summary TEXT NOT NULL,
    accent TEXT NOT NULL CHECK(accent IN ('climate', 'democracy', 'education', 'health', 'housing', 'labor', 'neutral')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (place_key) REFERENCES place_contexts(place_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_place_scope_links_place ON place_scope_links(place_key);
CREATE INDEX IF NOT EXISTS idx_place_query_filters_place ON place_query_filters(place_key);
CREATE INDEX IF NOT EXISTS idx_place_summary_facts_place ON place_summary_facts(place_key);
CREATE INDEX IF NOT EXISTS idx_place_governments_place ON place_governments(place_key);
CREATE INDEX IF NOT EXISTS idx_place_government_links_government
    ON place_government_links(government_id);
CREATE INDEX IF NOT EXISTS idx_place_related_places_place ON place_related_places(place_key);

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
    name = excluded.name,
    display = excluded.display,
    kind = excluded.kind,
    source_dataset = excluded.source_dataset,
    source_identifier = excluded.source_identifier,
    source_url = excluded.source_url,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');

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
    name = excluded.name,
    display = excluded.display,
    kind = excluded.kind,
    source_dataset = excluded.source_dataset,
    source_identifier = excluded.source_identifier,
    source_url = excluded.source_url,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
